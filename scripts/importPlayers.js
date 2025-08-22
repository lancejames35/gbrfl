/**
 * Simple Player Import Script
 * node scripts/importPlayers.js
 */

const fs = require('fs');
const Papa = require('papaparse');
const db = require('../config/database');

// Team code to ID mapping based on your nfl_teams table
const TEAM_MAPPING = {
    'ARI': 1, 'ATL': 2, 'BAL': 3, 'BUF': 4, 'CAR': 5, 'CHI': 6, 'CIN': 7, 'CLE': 8,
    'DAL': 9, 'DEN': 10, 'DET': 11, 'GB': 12, 'HOU': 13, 'IND': 14, 'JAC': 15, 'KC': 16,
    'LAC': 17, 'LAR': 18, 'LV': 19, 'MIA': 20, 'MIN': 21, 'NE': 22, 'NO': 23, 'NYG': 24,
    'NYJ': 25, 'PHI': 26, 'PIT': 27, 'SEA': 28, 'SF': 29, 'TB': 30, 'TEN': 31, 'WAS': 32,
    'FA': 33  // Free Agent
};

async function importPlayers() {
    try {
        console.log('Starting player import...');
        
        // Read the CSV file
        const csvData = fs.readFileSync('./uploads/players-sample.csv', 'utf8');
        const parsed = Papa.parse(csvData, {
            header: true,
            skipEmptyLines: true
        });

        console.log(`Found ${parsed.data.length} players to import`);

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (let i = 0; i < parsed.data.length; i++) {
            const player = parsed.data[i];
            
            try {
                // Validate required fields
                if (!player.first_name || !player.last_name || !player.display_name || !player.position) {
                    throw new Error(`Missing required fields`);
                }

                // Map team code to ID
                let nflTeamId = null;
                if (player.nfl_team_code) {
                    nflTeamId = TEAM_MAPPING[player.nfl_team_code.toUpperCase()];
                    if (nflTeamId === undefined) {
                        // Map unknown team codes to Free Agent and log a warning
                        console.log(`⚠️  Unknown team code '${player.nfl_team_code}' for ${player.display_name} - mapping to Free Agent`);
                        nflTeamId = 33; // Free Agent
                    }
                }

                // Insert player
                await db.query(`
                    INSERT INTO nfl_players (first_name, last_name, display_name, nfl_team_id, position)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    player.first_name.trim(),
                    player.last_name.trim(), 
                    player.display_name.trim(),
                    nflTeamId,
                    player.position.trim().toUpperCase()
                ]);

                successCount++;
                
                // Progress indicator
                if (successCount % 50 === 0) {
                    console.log(`Imported ${successCount} players...`);
                }

            } catch (error) {
                errorCount++;
                const errorMsg = `Row ${i + 1} (${player.display_name}): ${error.message}`;
                errors.push(errorMsg);
                console.log(`❌ ${errorMsg}`);
            }
        }

        console.log(`\n✅ Import Complete!`);
        console.log(`   Successful: ${successCount}`);
        console.log(`   Errors: ${errorCount}`);

        if (errors.length > 0 && errors.length <= 10) {
            console.log('\nErrors:');
            errors.forEach(error => console.log(`  ${error}`));
        } else if (errors.length > 10) {
            console.log(`\nFirst 10 errors:`);
            errors.slice(0, 10).forEach(error => console.log(`  ${error}`));
            console.log(`  ... and ${errors.length - 10} more errors`);
        }

        // Show summary
        const summary = await db.query(`
            SELECT position, COUNT(*) as count 
            FROM nfl_players 
            GROUP BY position 
            ORDER BY count DESC
        `);
        
        console.log('\nPlayers by position:');
        summary.forEach(row => {
            console.log(`  ${row.position}: ${row.count}`);
        });

        // Show total
        const total = await db.query('SELECT COUNT(*) as total FROM nfl_players');
        console.log(`\nTotal players in database: ${total[0].total}`);

        // Show players mapped to Free Agent due to unknown team codes
        const freeAgents = await db.query(`
            SELECT p.display_name, p.first_name, p.last_name, p.position
            FROM nfl_players p
            JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
            WHERE nt.team_code = 'FA'
            ORDER BY p.display_name
        `);
        
        if (freeAgents.length > 0) {
            console.log(`\nFree Agents (${freeAgents.length} players):`);
            freeAgents.forEach(player => {
                console.log(`  ${player.display_name} (${player.position})`);
            });
        }

    } catch (error) {
        console.error('Import failed:', error.message);
        process.exit(1);
    }
}

// Run the import
importPlayers().then(() => {
    console.log('\nDone!');
    process.exit(0);
}).catch(error => {
    console.error('Failed:', error);
    process.exit(1);
});