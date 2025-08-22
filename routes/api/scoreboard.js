const express = require('express');
const router = express.Router();
const ScoreCalculator = require('../../classes/ScoreCalculator');
const HeadToHeadCalculator = require('../../classes/HeadToHeadCalculator');
const { authenticateHybrid } = require('../../middleware/auth');

// Initialize calculators
const scoreCalculator = new ScoreCalculator();
const h2hCalculator = new HeadToHeadCalculator();

// Get weekly matchups
router.get('/matchups', authenticateHybrid, async (req, res) => {
    try {
        const { week, season = 2024, game_type = 'primary' } = req.query;
        
        if (!week) {
            return res.status(400).json({ success: false, error: 'Week parameter required' });
        }
        
        const matchups = await scoreCalculator.getWeeklyMatchups(parseInt(week), game_type, parseInt(season));
        
        // Add category summaries
        const matchupsWithSummary = matchups.map(matchup => ({
            ...matchup,
            category_summary: h2hCalculator.getCategorySummary(matchup)
        }));
        
        res.json({ success: true, data: matchupsWithSummary });
    } catch (error) {
        console.error('API Error - weekly matchups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get team breakdown
router.get('/team-breakdown', authenticateHybrid, async (req, res) => {
    try {
        const { team_id, week, season = 2024, game_type = 'primary' } = req.query;
        
        if (!team_id || !week) {
            return res.status(400).json({ success: false, error: 'Team ID and week required' });
        }
        
        const breakdown = await scoreCalculator.getTeamScoreBreakdown(
            parseInt(team_id), 
            parseInt(week), 
            game_type, 
            parseInt(season)
        );
        
        res.json({ success: true, data: breakdown });
    } catch (error) {
        console.error('API Error - team breakdown:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get matchup detail
router.get('/matchup-detail', authenticateHybrid, async (req, res) => {
    try {
        const { team1_id, team2_id, week, season = 2024, game_type = 'primary' } = req.query;
        
        if (!team1_id || !team2_id || !week) {
            return res.status(400).json({ success: false, error: 'Team IDs and week required' });
        }
        
        const matchup = await h2hCalculator.calculateMatchup(
            parseInt(team1_id),
            parseInt(team2_id),
            parseInt(week),
            game_type,
            parseInt(season)
        );
        
        if (matchup) {
            matchup.category_summary = h2hCalculator.getCategorySummary(matchup);
        }
        
        res.json({ success: true, data: matchup });
    } catch (error) {
        console.error('API Error - matchup detail:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get season standings
router.get('/standings', authenticateHybrid, async (req, res) => {
    try {
        const { season = 2024 } = req.query;
        const standings = await scoreCalculator.getSeasonStandings(parseInt(season));
        res.json({ success: true, data: standings });
    } catch (error) {
        console.error('API Error - standings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available seasons
router.get('/seasons', authenticateHybrid, async (req, res) => {
    try {
        const seasons = await scoreCalculator.getAvailableSeasons();
        res.json({ success: true, data: seasons });
    } catch (error) {
        console.error('API Error - seasons:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available weeks
router.get('/weeks', authenticateHybrid, async (req, res) => {
    try {
        const { season = 2024 } = req.query;
        const weeks = await scoreCalculator.getAvailableWeeks(parseInt(season));
        res.json({ success: true, data: weeks });
    } catch (error) {
        console.error('API Error - weeks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;