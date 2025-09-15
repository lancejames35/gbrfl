/**
 * ESPN Player Synchronization Script
 * Updates nfl_players table with team changes from espn_players table
 * node scripts/syncPlayersFromEspn.js
 */

const db = require('../config/database');

async function syncPlayersFromEspn() {
    try {
        console.log('🔄 Starting ESPN player synchronization...');

        // Get current statistics
        const beforeStats = await db.query(`
            SELECT COUNT(*) as mismatched_players
            FROM nfl_players np
            LEFT JOIN espn_players ep ON np.espn_id = ep.espn_id
            WHERE np.nfl_team_id != ep.team_id
            AND ep.espn_id IS NOT NULL
        `);

        console.log(`📊 Found ${beforeStats[0].mismatched_players} players with team mismatches`);

        if (beforeStats[0].mismatched_players === 0) {
            console.log('✅ No synchronization needed - all players are up to date!');
            return;
        }

        // Perform the synchronization using team abbreviations as the common key
        const updateResult = await db.query(`
            UPDATE nfl_players np
            JOIN espn_players ep ON np.espn_id = ep.espn_id
            JOIN nfl_teams nt ON nt.team_code = ep.team_abbreviation
            SET np.nfl_team_id = nt.nfl_team_id
            WHERE np.espn_id IS NOT NULL
            AND np.nfl_team_id != nt.nfl_team_id
        `);

        console.log(`🔄 Updated ${updateResult.affectedRows} player team assignments`);

        // Get final statistics
        const afterStats = await db.query(`
            SELECT COUNT(*) as mismatched_players
            FROM nfl_players np
            LEFT JOIN espn_players ep ON np.espn_id = ep.espn_id
            WHERE np.nfl_team_id != ep.team_id
            AND ep.espn_id IS NOT NULL
        `);

        console.log(`📊 Remaining mismatches: ${afterStats[0].mismatched_players}`);

        // Show a sample of updated players
        const updatedPlayers = await db.query(`
            SELECT np.display_name, nt.team_name, nt.team_code, ep.team_name as espn_team
            FROM nfl_players np
            JOIN espn_players ep ON np.espn_id = ep.espn_id
            JOIN nfl_teams nt ON np.nfl_team_id = nt.nfl_team_id
            WHERE nt.team_code = ep.team_abbreviation
            ORDER BY np.display_name
            LIMIT 10
        `);

        if (updatedPlayers.length > 0) {
            console.log('\n✅ Sample of synchronized players:');
            updatedPlayers.forEach(player => {
                console.log(`   ${player.display_name} → ${player.team_name} (${player.team_code})`);
            });
        }

        // Check for any unmatched ESPN teams
        const unmatchedTeams = await db.query(`
            SELECT DISTINCT ep.team_abbreviation, ep.team_name
            FROM espn_players ep
            LEFT JOIN nfl_teams nt ON nt.team_code = ep.team_abbreviation
            WHERE nt.nfl_team_id IS NULL
        `);

        if (unmatchedTeams.length > 0) {
            console.log('\n⚠️  ESPN teams not found in nfl_teams table:');
            unmatchedTeams.forEach(team => {
                console.log(`   ${team.team_abbreviation} - ${team.team_name}`);
            });
        }

        console.log('\n✅ ESPN player synchronization completed!');

    } catch (error) {
        console.error('❌ Synchronization failed:', error.message);
        throw error;
    }
}

// Run the synchronization
if (require.main === module) {
    syncPlayersFromEspn()
        .then(() => {
            console.log('\n🎉 Done!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Failed:', error);
            process.exit(1);
        });
}

module.exports = { syncPlayersFromEspn };