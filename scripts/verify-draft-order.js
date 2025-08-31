const mysql = require('mysql2/promise');

async function verifyDraftOrder() {
  const connection = await mysql.createConnection({
    uri: 'mysql://root:JZjKXAUlauvUwThojErTNcsjYOIhOMDa@caboose.proxy.rlwy.net:59613/railway'
  });

  try {
    console.log('=== DRAFT ORDER TABLE ANALYSIS ===\n');
    
    // 1. Check for traded picks
    const [tradedPicks] = await connection.execute(`
      SELECT 
        round,
        pick_number,
        fantasy_team_id,
        original_team_id,
        ft1.team_name as current_owner,
        ft2.team_name as original_owner
      FROM draft_order do
      LEFT JOIN fantasy_teams ft1 ON do.fantasy_team_id = ft1.team_id
      LEFT JOIN fantasy_teams ft2 ON do.original_team_id = ft2.team_id
      WHERE do.fantasy_team_id != do.original_team_id
        AND do.season = 2025
      ORDER BY round, pick_number
    `);
    
    console.log(`Found ${tradedPicks.length} traded picks:`);
    console.log('----------------------------------------');
    tradedPicks.forEach(pick => {
      console.log(`Round ${pick.round}, Pick ${pick.pick_number}:`);
      console.log(`  Current Owner: ${pick.current_owner} (team_id: ${pick.fantasy_team_id})`);
      console.log(`  Original Owner: ${pick.original_owner} (team_id: ${pick.original_team_id})`);
      console.log('');
    });
    
    // 2. Show team-by-team pick ownership
    console.log('\n=== PICKS BY TEAM ===\n');
    const [teams] = await connection.execute(`
      SELECT DISTINCT ft.team_id, ft.team_name 
      FROM fantasy_teams ft
      ORDER BY ft.team_id
    `);
    
    for (const team of teams) {
      const [picks] = await connection.execute(`
        SELECT 
          round,
          pick_number,
          CASE 
            WHEN fantasy_team_id != original_team_id THEN 'ACQUIRED'
            ELSE 'ORIGINAL'
          END as pick_status,
          ft2.team_name as from_team
        FROM draft_order do
        LEFT JOIN fantasy_teams ft2 ON do.original_team_id = ft2.team_id
        WHERE do.fantasy_team_id = ? 
          AND do.season = 2025
        ORDER BY round, pick_number
      `, [team.team_id]);
      
      const [tradedAway] = await connection.execute(`
        SELECT 
          round,
          pick_number,
          ft.team_name as traded_to
        FROM draft_order do
        LEFT JOIN fantasy_teams ft ON do.fantasy_team_id = ft.team_id
        WHERE do.original_team_id = ? 
          AND do.fantasy_team_id != ?
          AND do.season = 2025
        ORDER BY round, pick_number
      `, [team.team_id, team.team_id]);
      
      console.log(`${team.team_name} (ID: ${team.team_id}):`);
      console.log(`  Currently owns ${picks.length} picks`);
      
      // Show acquired picks
      const acquired = picks.filter(p => p.pick_status === 'ACQUIRED');
      if (acquired.length > 0) {
        console.log('  Acquired picks:');
        acquired.forEach(p => {
          console.log(`    - Round ${p.round}, Pick ${p.pick_number} from ${p.from_team}`);
        });
      }
      
      // Show traded away picks
      if (tradedAway.length > 0) {
        console.log('  Traded away:');
        tradedAway.forEach(p => {
          console.log(`    - Round ${p.round}, Pick ${p.pick_number} to ${p.traded_to}`);
        });
      }
      console.log('');
    }
    
    // 3. Verify draft order integrity
    console.log('=== DRAFT ORDER INTEGRITY CHECK ===\n');
    const [rounds] = await connection.execute(`
      SELECT round, COUNT(*) as pick_count
      FROM draft_order
      WHERE season = 2025
      GROUP BY round
      ORDER BY round
    `);
    
    console.log('Picks per round:');
    rounds.forEach(r => {
      console.log(`  Round ${r.round}: ${r.pick_count} picks`);
    });
    
    // Check for any missing picks
    const [missing] = await connection.execute(`
      SELECT DISTINCT round
      FROM draft_order
      WHERE season = 2025
    `);
    
    const expectedPicks = 10; // 10 teams
    let hasIssues = false;
    
    for (const roundData of rounds) {
      if (roundData.pick_count !== expectedPicks) {
        console.log(`⚠️  WARNING: Round ${roundData.round} has ${roundData.pick_count} picks, expected ${expectedPicks}`);
        hasIssues = true;
      }
    }
    
    if (!hasIssues) {
      console.log('✅ All rounds have correct number of picks');
    }
    
    // 4. Show specific trade examples
    console.log('\n=== TRADE EXAMPLES ===\n');
    const [exampleTrades] = await connection.execute(`
      SELECT 
        CONCAT('Round ', round, ', Pick ', pick_number) as pick,
        ft1.team_name as current_owner,
        ft2.team_name as original_owner
      FROM draft_order do
      LEFT JOIN fantasy_teams ft1 ON do.fantasy_team_id = ft1.team_id
      LEFT JOIN fantasy_teams ft2 ON do.original_team_id = ft2.team_id
      WHERE do.fantasy_team_id != do.original_team_id
        AND do.season = 2025
      LIMIT 5
    `);
    
    if (exampleTrades.length > 0) {
      console.log('Example traded picks:');
      exampleTrades.forEach(trade => {
        console.log(`  ${trade.pick}: ${trade.original_owner} → ${trade.current_owner}`);
      });
    }

  } finally {
    await connection.end();
  }
}

verifyDraftOrder().catch(console.error);