/**
 * Import lineups from CSV file into lineup_positions table
 *
 * Usage: node scripts/importLineups.js [path-to-csv]
 * Default: scripts/lineups.csv or ../lineups.csv
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

// Position mapping from CSV to database
const positionTypeMap = {
  'QB': 'quarterback',
  'RB': 'running_back',
  'RC': 'receiver',
  'PK': 'place_kicker',
  'DU': 'defense'
};

async function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  // Detect delimiter (comma or tab)
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  console.log(`Using delimiter: ${delimiter === '\t' ? 'tab' : 'comma'}`);

  // Parse header
  const header = firstLine.split(delimiter);
  const columnIndex = {};
  header.forEach((col, idx) => {
    columnIndex[col.trim()] = idx;
  });

  console.log('Columns found:', Object.keys(columnIndex));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter);
    if (values.length < 7) continue;

    const row = {
      week: parseInt(values[columnIndex['Week']], 10),
      gameType: values[columnIndex['Game Type']]?.trim(),
      teamId: parseInt(values[columnIndex['Team ID']], 10),
      teamName: values[columnIndex['Fantasy Team Name']]?.trim(),
      position: values[columnIndex['Position']]?.trim(),
      player: values[columnIndex['Player']]?.trim(),
      playerId: values[columnIndex['player_id']]?.trim()
    };

    // Skip invalid rows
    if (isNaN(row.week) || isNaN(row.teamId)) continue;

    // Skip HeadCoach rows
    if (row.position === 'HeadCoach') continue;

    // Skip rows without player_id
    if (!row.playerId) {
      console.warn(`Warning: No player_id for ${row.player} (Week ${row.week}, Team ${row.teamId})`);
      continue;
    }

    rows.push(row);
  }

  return rows;
}

// Cache for weeks with bonus games
const weeksWithBonusGames = new Map();

async function checkWeekHasBonusGames(week, seasonYear = 2025) {
  const cacheKey = `${week}-${seasonYear}`;
  if (weeksWithBonusGames.has(cacheKey)) {
    return weeksWithBonusGames.get(cacheKey);
  }

  const result = await db.query(`
    SELECT COUNT(*) as count FROM weekly_schedule
    WHERE week_number = ? AND season_year = ? AND game_type = 'bonus'
  `, [week, seasonYear]);

  const hasBonusGames = result[0].count > 0;
  weeksWithBonusGames.set(cacheKey, hasBonusGames);
  return hasBonusGames;
}

async function getLineupId(teamId, week, gameType, seasonYear = 2025) {
  // Check if bonus games exist for this week before creating bonus lineup
  if (gameType === 'bonus') {
    const hasBonusGames = await checkWeekHasBonusGames(week, seasonYear);
    if (!hasBonusGames) {
      console.warn(`Skipping bonus lineup for Week ${week} - no bonus games scheduled for this week`);
      return null;
    }
  }

  const result = await db.query(`
    SELECT lineup_id FROM lineup_submissions
    WHERE fantasy_team_id = ? AND week_number = ? AND game_type = ? AND season_year = ?
  `, [teamId, week, gameType, seasonYear]);

  if (result.length > 0) {
    return result[0].lineup_id;
  }

  // Create new lineup submission if it doesn't exist
  const insertResult = await db.query(`
    INSERT INTO lineup_submissions (fantasy_team_id, week_number, game_type, season_year, created_at)
    VALUES (?, ?, ?, ?, NOW())
  `, [teamId, week, gameType, seasonYear]);

  return insertResult.insertId;
}

async function importLineups(filePath) {
  console.log(`Reading CSV from: ${filePath}`);

  const rows = await parseCSV(filePath);
  console.log(`Parsed ${rows.length} player rows (excluding HeadCoach)`);

  // Group by team/week/gameType
  const lineups = {};
  for (const row of rows) {
    const key = `${row.teamId}-${row.week}-${row.gameType}`;
    if (!lineups[key]) {
      lineups[key] = {
        teamId: row.teamId,
        week: row.week,
        gameType: row.gameType,
        positions: {}
      };
    }

    const positionType = positionTypeMap[row.position];
    if (!positionType) {
      console.warn(`Unknown position: ${row.position} for ${row.player}`);
      continue;
    }

    if (!lineups[key].positions[positionType]) {
      lineups[key].positions[positionType] = [];
    }

    lineups[key].positions[positionType].push({
      playerId: parseInt(row.playerId, 10),
      player: row.player
    });
  }

  console.log(`Found ${Object.keys(lineups).length} unique lineups to import`);

  // Process each lineup
  let processed = 0;
  let errors = 0;

  for (const key of Object.keys(lineups)) {
    const lineup = lineups[key];

    try {
      // Get or create lineup_id (returns null for bonus lineups in weeks without bonus games)
      const lineupId = await getLineupId(lineup.teamId, lineup.week, lineup.gameType);

      // Skip if lineup was not created (e.g., bonus lineup for week without bonus games)
      if (lineupId === null) {
        continue;
      }

      // Delete existing positions for this lineup
      await db.query('DELETE FROM lineup_positions WHERE lineup_id = ?', [lineupId]);

      // Insert new positions
      for (const positionType of Object.keys(lineup.positions)) {
        const players = lineup.positions[positionType];

        for (let i = 0; i < players.length; i++) {
          const player = players[i];
          const sortOrder = i + 1;

          // Get nfl_team_id for the player
          const playerInfo = await db.query(
            'SELECT nfl_team_id FROM nfl_players WHERE player_id = ?',
            [player.playerId]
          );
          const nflTeamId = playerInfo.length > 0 ? playerInfo[0].nfl_team_id : null;

          await db.query(`
            INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
          `, [lineupId, positionType, player.playerId, nflTeamId, sortOrder]);
        }
      }

      processed++;
      if (processed % 50 === 0) {
        console.log(`Processed ${processed} lineups...`);
      }
    } catch (error) {
      console.error(`Error processing lineup ${key}:`, error.message);
      errors++;
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Processed: ${processed} lineups`);
  console.log(`  Errors: ${errors}`);
}

// Main execution
async function main() {
  try {
    // Determine file path
    let filePath = process.argv[2];

    if (!filePath) {
      // Try default locations
      const defaultPaths = [
        path.join(__dirname, 'lineups.csv'),
        path.join(__dirname, '..', 'lineups.csv')
      ];

      for (const p of defaultPaths) {
        if (fs.existsSync(p)) {
          filePath = p;
          break;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      console.error('Error: CSV file not found');
      console.error('Usage: node scripts/importLineups.js [path-to-csv]');
      process.exit(1);
    }

    await importLineups(filePath);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
