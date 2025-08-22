#!/usr/bin/env node

/**
 * Test script for the enhanced scoreboard functionality
 * Verifies database connections, scoring calculations, and API endpoints
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../config/database');
const ScoreCalculator = require('../classes/ScoreCalculator');
const HeadToHeadCalculator = require('../classes/HeadToHeadCalculator');

// Initialize calculators
const scoreCalculator = new ScoreCalculator();
const h2hCalculator = new HeadToHeadCalculator();

async function testDatabaseConnection() {
    console.log('🔍 Testing database connection...');
    try {
        const result = await db.query('SELECT COUNT(*) as count FROM fantasy_teams');
        console.log(`✅ Database connected. Found ${result[0].count} fantasy teams.`);
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

async function testTeamData() {
    console.log('\n🏈 Testing team data...');
    try {
        const teams = await scoreCalculator.getAllTeams();
        if (teams && teams.length > 0) {
            console.log(`✅ Found ${teams.length} teams:`);
            teams.slice(0, 3).forEach(team => {
                console.log(`   - ${team.team_name} (${team.username})`);
            });
            return teams;
        } else {
            console.log('⚠️  No teams found in database');
            return [];
        }
    } catch (error) {
        console.error('❌ Team data test failed:', error.message);
        return [];
    }
}

async function testSeasonData() {
    console.log('\n📅 Testing season data...');
    try {
        const seasons = await scoreCalculator.getAvailableSeasons();
        const currentSeason = seasons.length > 0 ? seasons[0] : 2024;
        const weeks = await scoreCalculator.getAvailableWeeks(currentSeason);
        
        console.log(`✅ Found ${seasons.length} seasons: [${seasons.join(', ')}]`);
        console.log(`✅ Found ${weeks.length} weeks for season ${currentSeason}: [${weeks.slice(0, 5).join(', ')}${weeks.length > 5 ? '...' : ''}]`);
        
        return { seasons, currentSeason, weeks };
    } catch (error) {
        console.error('❌ Season data test failed:', error.message);
        return { seasons: [], currentSeason: 2024, weeks: [] };
    }
}

async function testPlayerStats() {
    console.log('\n👤 Testing player stats data...');
    try {
        const sql = `
            SELECT ps.*, np.display_name, np.position 
            FROM player_stats ps 
            LEFT JOIN nfl_players np ON CAST(ps.player_id AS CHAR) = CAST(np.player_id AS CHAR) 
            LIMIT 5
        `;
        const players = await db.query(sql);
        
        if (players && players.length > 0) {
            console.log(`✅ Found player stats. Sample players:`);
            players.forEach(player => {
                console.log(`   - ${player.display_name || 'Unknown'} (${player.position || 'N/A'}) - Week ${player.week}`);
            });
        } else {
            console.log('⚠️  No player stats found in database');
        }
        
        return players;
    } catch (error) {
        console.error('❌ Player stats test failed:', error.message);
        return [];
    }
}

async function testDefenseStats() {
    console.log('\n🛡️  Testing defense stats data...');
    try {
        const sql = `
            SELECT tds.team, tds.opponent, tds.week, tds.season,
                   tds.points_allowed, tds.total_yards_allowed, tds.sacks
            FROM team_defense_stats tds 
            LIMIT 5
        `;
        const defenseStats = await db.query(sql);
        
        if (defenseStats && defenseStats.length > 0) {
            console.log(`✅ Found defense stats. Sample teams:`);
            defenseStats.forEach(def => {
                console.log(`   - ${def.team} vs ${def.opponent} - Week ${def.week}: ${def.points_allowed} PA, ${def.total_yards_allowed} YA`);
            });
        } else {
            console.log('⚠️  No defense stats found in database');
        }
        
        return defenseStats;
    } catch (error) {
        console.error('❌ Defense stats test failed:', error.message);
        return [];
    }
}

async function testLineupData() {
    console.log('\n📋 Testing lineup data...');
    try {
        const sql = `
            SELECT ls.*, ft.team_name
            FROM lineup_submissions ls 
            JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
            LIMIT 5
        `;
        const lineups = await db.query(sql);
        
        if (lineups && lineups.length > 0) {
            console.log(`✅ Found lineup submissions. Sample lineups:`);
            lineups.forEach(lineup => {
                console.log(`   - ${lineup.team_name}: Week ${lineup.week_number}, ${lineup.game_type} game`);
            });
        } else {
            console.log('⚠️  No lineup submissions found in database');
        }
        
        return lineups;
    } catch (error) {
        console.error('❌ Lineup data test failed:', error.message);
        return [];
    }
}

async function testMatchupCalculation(teams, seasonData) {
    console.log('\n⚔️  Testing matchup calculation...');
    try {
        if (teams.length < 2 || seasonData.weeks.length === 0) {
            console.log('⚠️  Insufficient data to test matchup calculation');
            return null;
        }
        
        const team1 = teams[0];
        const team2 = teams[1];
        const week = seasonData.weeks[0];
        const season = seasonData.currentSeason;
        
        console.log(`   Testing matchup: ${team1.team_name} vs ${team2.team_name} (Week ${week})`);
        
        const matchup = await h2hCalculator.calculateMatchup(
            team1.team_id, 
            team2.team_id, 
            week, 
            'primary', 
            season
        );
        
        if (matchup) {
            console.log('✅ Matchup calculation successful!');
            console.log(`   - ${team1.team_name}: ${matchup.team1_score} H2H + ${matchup.team1_bonus} bonus = ${matchup.team1_final_score} total`);
            console.log(`   - ${team2.team_name}: ${matchup.team2_score} H2H + ${matchup.team2_bonus} bonus = ${matchup.team2_final_score} total`);
            console.log(`   - Winner: ${matchup.winner}`);
            
            // Test category summary
            const summary = h2hCalculator.getCategorySummary(matchup);
            console.log(`   - Categories won: ${summary.team1_categories_won} - ${summary.team2_categories_won} (${summary.ties} ties)`);
        } else {
            console.log('⚠️  Matchup calculation returned null (may be expected if no lineup data)');
        }
        
        return matchup;
    } catch (error) {
        console.error('❌ Matchup calculation test failed:', error.message);
        return null;
    }
}

async function testWeeklyMatchups(seasonData) {
    console.log('\n📊 Testing weekly matchups...');
    try {
        if (seasonData.weeks.length === 0) {
            console.log('⚠️  No weeks available to test');
            return [];
        }
        
        const week = seasonData.weeks[0];
        const season = seasonData.currentSeason;
        
        const matchups = await scoreCalculator.getWeeklyMatchups(week, 'primary', season);
        
        if (matchups && matchups.length > 0) {
            console.log(`✅ Found ${matchups.length} matchups for Week ${week}:`);
            matchups.forEach((matchup, index) => {
                console.log(`   ${index + 1}. ${matchup.team1_name} vs ${matchup.team2_name}`);
            });
        } else {
            console.log('⚠️  No matchups found (may be expected if no schedule data)');
        }
        
        return matchups;
    } catch (error) {
        console.error('❌ Weekly matchups test failed:', error.message);
        return [];
    }
}

async function testScoringRules() {
    console.log('\n📐 Testing scoring rules configuration...');
    try {
        const scoringRules = require('../config/scoring_rules');
        
        if (!scoringRules || !scoringRules.categories) {
            throw new Error('Scoring rules not properly configured');
        }
        
        const categories = Object.keys(scoringRules.categories);
        console.log(`✅ Scoring rules loaded with ${categories.length} categories: [${categories.join(', ')}]`);
        
        // Test a few specific rules
        const passing = scoringRules.categories.passing;
        if (passing.touchdowns && passing.touchdowns.h2h_points === 6) {
            console.log('   ✅ Passing TD points: 6 (correct)');
        }
        
        if (passing.touchdowns && passing.touchdowns.bonus_threshold === 6 && passing.touchdowns.bonus_points === 2) {
            console.log('   ✅ Passing TD bonus: 2 points at 6+ TDs (correct)');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Scoring rules test failed:', error.message);
        return false;
    }
}

async function runAllTests() {
    console.log('🚀 Starting Enhanced Scoreboard Tests...\n');
    
    const results = {
        database: false,
        teams: [],
        seasonData: { seasons: [], weeks: [], currentSeason: 2024 },
        players: [],
        defense: [],
        lineups: [],
        matchup: null,
        matchups: [],
        scoringRules: false
    };
    
    // Run all tests
    results.database = await testDatabaseConnection();
    if (results.database) {
        results.teams = await testTeamData();
        results.seasonData = await testSeasonData();
        results.players = await testPlayerStats();
        results.defense = await testDefenseStats();
        results.lineups = await testLineupData();
        results.matchup = await testMatchupCalculation(results.teams, results.seasonData);
        results.matchups = await testWeeklyMatchups(results.seasonData);
        results.scoringRules = await testScoringRules();
    }
    
    // Summary
    console.log('\n📈 TEST SUMMARY:');
    console.log('================');
    console.log(`Database Connection: ${results.database ? '✅' : '❌'}`);
    console.log(`Teams: ${results.teams.length > 0 ? '✅' : '⚠️'} (${results.teams.length} found)`);
    console.log(`Seasons/Weeks: ${results.seasonData.weeks.length > 0 ? '✅' : '⚠️'} (${results.seasonData.weeks.length} weeks found)`);
    console.log(`Player Stats: ${results.players.length > 0 ? '✅' : '⚠️'} (${results.players.length} sample records)`);
    console.log(`Defense Stats: ${results.defense.length > 0 ? '✅' : '⚠️'} (${results.defense.length} sample records)`);
    console.log(`Lineup Data: ${results.lineups.length > 0 ? '✅' : '⚠️'} (${results.lineups.length} submissions)`);
    console.log(`Matchup Calculation: ${results.matchup ? '✅' : '⚠️'}`);
    console.log(`Weekly Matchups: ${results.matchups.length > 0 ? '✅' : '⚠️'} (${results.matchups.length} found)`);
    console.log(`Scoring Rules: ${results.scoringRules ? '✅' : '❌'}`);
    
    const readyForTesting = results.database && results.scoringRules && results.teams.length > 0;
    
    console.log(`\n🎯 ENHANCED SCOREBOARD STATUS: ${readyForTesting ? '✅ READY FOR TESTING' : '⚠️ NEEDS DATA'}`);
    
    if (readyForTesting) {
        console.log('\n🌐 To test the enhanced scoreboard:');
        console.log('   1. Run: npm run dev');
        console.log('   2. Visit: http://localhost:3000/scoreboard');
        console.log('   3. Try both Enhanced and Classic layouts using the Layout dropdown');
    } else {
        console.log('\n📝 TO DO:');
        if (!results.database) console.log('   - Fix database connection');
        if (results.teams.length === 0) console.log('   - Add fantasy teams to database');
        if (results.seasonData.weeks.length === 0) console.log('   - Add lineup submissions to database');
        if (results.players.length === 0) console.log('   - Import player stats data');
        if (!results.scoringRules) console.log('   - Fix scoring rules configuration');
    }
    
    process.exit(0);
}

// Run tests if this script is executed directly
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('❌ Test runner failed:', error);
        process.exit(1);
    });
}

module.exports = {
    testDatabaseConnection,
    testTeamData,
    testSeasonData,
    testPlayerStats,
    testMatchupCalculation,
    runAllTests
};