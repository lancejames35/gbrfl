const mysql = require('mysql2/promise');

async function runQuery() {
  const connection = await mysql.createConnection({
    uri: 'mysql://root:JZjKXAUlauvUwThojErTNcsjYOIhOMDa@caboose.proxy.rlwy.net:59613/railway'
  });

  try {
    // Check draft settings
    const [settings] = await connection.execute(
      'SELECT draft_rounds, teams_count FROM league_settings WHERE season_year = 2025'
    );
    console.log('League Settings:', settings);

    // Check for FA players
    const [faPlayers] = await connection.execute(
      `SELECT COUNT(*) as count 
       FROM nfl_players p 
       LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id 
       WHERE nt.team_code = 'FA' OR p.nfl_team_id IS NULL`
    );
    console.log('Free Agent Players:', faPlayers);

    // Check NFL teams
    const [teams] = await connection.execute(
      `SELECT nfl_team_id, team_name, team_code 
       FROM nfl_teams 
       WHERE team_code IN ('FA', 'NULL') OR team_name LIKE '%Free%'`
    );
    console.log('FA Team Records:', teams);

    // Sample some FA players
    const [sampleFA] = await connection.execute(
      `SELECT p.player_id, p.display_name, p.position, p.nfl_team_id, nt.team_code, nt.team_name
       FROM nfl_players p 
       LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id 
       WHERE p.nfl_team_id IS NULL OR nt.team_code = 'FA'
       LIMIT 5`
    );
    console.log('Sample FA Players:', sampleFA);

  } finally {
    await connection.end();
  }
}

runQuery().catch(console.error);