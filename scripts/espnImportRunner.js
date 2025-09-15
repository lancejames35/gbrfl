#!/usr/bin/env node

const mysql = require('mysql2/promise');
const axios = require('axios');

// Database configuration - will use Railway environment variables in production
const DB_CONFIG = {
    host: process.env.DB_HOST || 'caboose.proxy.rlwy.net',
    port: process.env.DB_PORT || 59613,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
    database: process.env.DB_NAME || 'railway'
};

// ESPN API endpoints
const ESPN_TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ESPN_TEAM_ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{}/roster";

// Positions we want to import
const TARGET_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'K']);

async function clearEspnPlayersTable(connection) {
    console.log("Clearing existing ESPN players data...");
    const [beforeResult] = await connection.execute("SELECT COUNT(*) as count FROM espn_players");
    const countBefore = beforeResult[0].count;
    console.log(`ESPN players before clear: ${countBefore}`);

    const [deleteResult] = await connection.execute("DELETE FROM espn_players");
    console.log(`Cleared ${deleteResult.affectedRows} existing ESPN players`);

    const [afterResult] = await connection.execute("SELECT COUNT(*) as count FROM espn_players");
    const countAfter = afterResult[0].count;
    console.log(`ESPN players after clear: ${countAfter}`);
}

async function getNflTeams() {
    console.log("Fetching NFL teams from ESPN...");

    try {
        const response = await axios.get(ESPN_TEAMS_URL, { timeout: 10000 });
        const data = response.data;

        const teams = [];
        const sportsData = data.sports || [];
        if (sportsData.length > 0) {
            const leaguesData = sportsData[0].leagues || [];
            if (leaguesData.length > 0) {
                const teamsData = leaguesData[0].teams || [];

                for (const team of teamsData) {
                    const teamInfo = team.team || {};
                    teams.push({
                        id: teamInfo.id,
                        abbreviation: (teamInfo.abbreviation || '').toUpperCase(),
                        displayName: teamInfo.displayName || '',
                        name: teamInfo.name || '',
                        location: teamInfo.location || ''
                    });
                }
            }
        }

        console.log(`Found ${teams.length} NFL teams`);
        return teams;
    } catch (error) {
        console.error(`Error fetching teams: ${error.message}`);
        return [];
    }
}

async function getTeamRoster(teamId, teamName, teamAbbreviation) {
    console.log(`Fetching roster for ${teamName}...`);

    try {
        const url = ESPN_TEAM_ROSTER_URL.replace('{}', teamId);
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        const players = [];
        const athletesGroups = data.athletes || [];

        for (const group of athletesGroups) {
            if (typeof group !== 'object') continue;

            const positionGroup = group.position || {};
            const positionGroupName = typeof positionGroup === 'object' ? (positionGroup.name || 'Unknown') : 'Unknown';
            const items = group.items || [];

            for (const player of items) {
                if (typeof player !== 'object') continue;

                try {
                    const positionInfo = player.position || {};
                    let positionAbbr = typeof positionInfo === 'object' ? (positionInfo.abbreviation || '') : '';

                    // Skip if not a target position
                    if (!TARGET_POSITIONS.has(positionAbbr)) continue;

                    // Normalize kicker position
                    if (positionAbbr === 'K') {
                        positionAbbr = 'PK';
                    }

                    const experienceInfo = player.experience || {};
                    const collegeInfo = player.college || {};
                    const statusInfo = player.status || {};

                    const playerData = {
                        espn_id: String(player.id || ''),
                        first_name: player.firstName || '',
                        last_name: player.lastName || '',
                        display_name: player.displayName || '',
                        jersey_number: String(player.jersey || ''),
                        position: positionAbbr,
                        position_full: typeof positionInfo === 'object' ? (positionInfo.name || '') : '',
                        position_group: positionGroupName,
                        team_id: String(teamId),
                        team_name: teamName,
                        team_abbreviation: teamAbbreviation,
                        height: String(player.height || ''),
                        weight: String(player.weight || ''),
                        age: String(player.age || ''),
                        experience: typeof experienceInfo === 'object' ? String(experienceInfo.years || '') : '',
                        college: typeof collegeInfo === 'object' ? (collegeInfo.name || '') : '',
                        active: Boolean(player.active !== false),
                        injured: Boolean(player.injured),
                        status: typeof statusInfo === 'object' ? (statusInfo.name || 'Active') : 'Active'
                    };

                    // Only add if we have essential data
                    if (playerData.espn_id && playerData.display_name && playerData.position) {
                        players.push(playerData);

                        // Debug Tank Bigsby specifically
                        if (playerData.display_name.includes('Bigsby')) {
                            console.log(`  >>> Found Tank Bigsby: ${playerData.display_name} on ${teamAbbreviation} (ESPN ID: ${playerData.espn_id})`);
                        }
                    }
                } catch (playerError) {
                    console.error(`Error processing player in ${teamName}: ${playerError.message}`);
                }
            }
        }

        console.log(`Found ${players.length} fantasy-relevant players for ${teamName}`);
        return players;
    } catch (error) {
        console.error(`Error fetching roster for ${teamName}: ${error.message}`);
        return [];
    }
}

async function insertPlayersBatch(connection, players) {
    if (!players || players.length === 0) return 0;

    const insertSql = `
        INSERT INTO espn_players (
            espn_id, first_name, last_name, display_name, position, position_full,
            position_group, jersey_number, team_id, team_name, team_abbreviation,
            height, weight, age, experience, college, active, injured, status
        ) VALUES ?
        ON DUPLICATE KEY UPDATE
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            display_name = VALUES(display_name),
            position = VALUES(position),
            position_full = VALUES(position_full),
            position_group = VALUES(position_group),
            jersey_number = VALUES(jersey_number),
            team_id = VALUES(team_id),
            team_name = VALUES(team_name),
            team_abbreviation = VALUES(team_abbreviation),
            height = VALUES(height),
            weight = VALUES(weight),
            age = VALUES(age),
            experience = VALUES(experience),
            college = VALUES(college),
            active = VALUES(active),
            injured = VALUES(injured),
            status = VALUES(status),
            updated_at = CURRENT_TIMESTAMP
    `;

    try {
        const values = players.map(player => [
            player.espn_id, player.first_name, player.last_name, player.display_name,
            player.position, player.position_full, player.position_group, player.jersey_number,
            player.team_id, player.team_name, player.team_abbreviation, player.height,
            player.weight, player.age, player.experience, player.college,
            player.active, player.injured, player.status
        ]);

        const [result] = await connection.query(insertSql, [values]);
        return players.length;
    } catch (error) {
        console.error(`Error inserting players: ${error.message}`);
        return 0;
    }
}

async function updatePlayerTeams(connection) {
    console.log("Updating nfl_players team assignments from ESPN data...");

    const teamUpdateSql = `
        UPDATE nfl_players np
        LEFT JOIN espn_players ep ON np.espn_id = ep.espn_id
        LEFT JOIN nfl_teams nt ON nt.team_code = ep.team_abbreviation
        SET np.nfl_team_id = CASE
            WHEN np.position = 'DU' THEN np.nfl_team_id
            WHEN ep.espn_id IS NOT NULL AND nt.nfl_team_id IS NOT NULL THEN nt.nfl_team_id
            ELSE 33
        END
        WHERE np.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
            OR np.espn_id IS NOT NULL
    `;

    try {
        const [result] = await connection.execute(teamUpdateSql);
        console.log(`Updated team assignments for ${result.affectedRows} players`);
        return result.affectedRows;
    } catch (error) {
        console.error(`Error updating player teams: ${error.message}`);
        return 0;
    }
}

async function addNewPlayersFromEspn(connection) {
    console.log("Adding new players from ESPN to nfl_players table...");

    // First, get count of new players to add
    const countSql = `
        SELECT COUNT(*) as new_players_count
        FROM espn_players ep
        LEFT JOIN nfl_players np ON ep.espn_id = np.espn_id
        WHERE np.espn_id IS NULL
            AND ep.position IN ('QB', 'RB', 'WR', 'TE', 'PK')
            AND ep.espn_id IS NOT NULL
            AND ep.espn_id != ''
    `;

    const [countResult] = await connection.execute(countSql);
    const newCount = countResult[0].new_players_count;

    if (newCount === 0) {
        console.log("No new players to add");
        return 0;
    }

    console.log(`Found ${newCount} new players to add to nfl_players table`);

    // Insert new players into nfl_players table
    const insertNewPlayersSql = `
        INSERT INTO nfl_players (
            first_name, last_name, display_name, nfl_team_id, position, espn_id
        )
        SELECT
            ep.first_name,
            ep.last_name,
            ep.display_name,
            COALESCE(nt.nfl_team_id, 33) as nfl_team_id,
            CASE
                WHEN ep.position IN ('WR', 'TE') THEN 'RC'
                ELSE ep.position
            END as position,
            ep.espn_id
        FROM espn_players ep
        LEFT JOIN nfl_players np ON ep.espn_id = np.espn_id
        LEFT JOIN nfl_teams nt ON nt.team_code = ep.team_abbreviation
        WHERE np.espn_id IS NULL
            AND ep.position IN ('QB', 'RB', 'WR', 'TE', 'PK')
            AND ep.espn_id IS NOT NULL
            AND ep.espn_id != ''
    `;

    try {
        const [result] = await connection.execute(insertNewPlayersSql);
        console.log(`Added ${result.affectedRows} new players to nfl_players table`);
        return result.affectedRows;
    } catch (error) {
        console.error(`Error adding new players: ${error.message}`);
        return 0;
    }
}

async function main() {
    console.log("Enhanced ESPN NFL Data Import & Team Update Script");
    console.log("=" * 60);
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log(`Target positions: ${Array.from(TARGET_POSITIONS).sort().join(', ')}`);
    console.log();

    let connection;
    try {
        // Connect to database
        connection = await mysql.createConnection(DB_CONFIG);
        console.log("Connected to MySQL database");

        // Step 1: Clear existing ESPN data
        await clearEspnPlayersTable(connection);

        // Step 2: Fetch and import ESPN data
        const teams = await getNflTeams();
        if (!teams || teams.length === 0) {
            console.log("Failed to fetch teams. Exiting.");
            return 1;
        }

        let totalPlayers = 0;

        // Process each team
        for (let i = 0; i < teams.length; i++) {
            const team = teams[i];
            console.log(`\nProcessing team ${i + 1}/${teams.length}: ${team.displayName}`);

            const players = await getTeamRoster(team.id, team.displayName, team.abbreviation);

            if (players && players.length > 0) {
                const inserted = await insertPlayersBatch(connection, players);
                totalPlayers += inserted;
                console.log(`Inserted ${inserted} players from ${team.displayName}`);
            }

            // Be nice to ESPN's servers
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Step 3: Update nfl_players team assignments
        console.log("\n" + "=".repeat(50));
        console.log("UPDATING TEAM ASSIGNMENTS");
        console.log("=".repeat(50));

        const affectedRows = await updatePlayerTeams(connection);

        // Step 4: Add new players from ESPN to nfl_players table
        console.log("\n" + "=".repeat(50));
        console.log("ADDING NEW PLAYERS");
        console.log("=".repeat(50));

        const newPlayersAdded = await addNewPlayersFromEspn(connection);

        console.log("\n" + "=".repeat(60));
        console.log("PROCESS COMPLETED SUCCESSFULLY!");
        console.log(`- Updated ${affectedRows} existing player team assignments`);
        console.log(`- Added ${newPlayersAdded} new players to nfl_players table`);
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log("=".repeat(60));

        return 0;

    } catch (error) {
        console.error(`Error: ${error.message}`);
        return 1;
    } finally {
        if (connection) {
            await connection.end();
            console.log("Database connection closed");
        }
    }
}

if (require.main === module) {
    main().then(exitCode => {
        process.exit(exitCode);
    });
}

module.exports = { main };