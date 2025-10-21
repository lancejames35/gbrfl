/**
 * Manual Scoreboard Controller
 * Handles public viewing of manually entered scores
 */

const MatchupScore = require('../models/MatchupScore');
const WeekSpreadsheet = require('../models/WeekSpreadsheet');
const WeeklySchedule = require('../models/WeeklySchedule');
const WeekStatus = require('../models/WeekStatus');
const db = require('../config/database');
const path = require('path');

/**
 * Get current week based on NFL game completion status
 * @returns {number} Current week number
 */
async function getCurrentWeek() {
  try {
    return await WeekStatus.getCurrentWeek();
  } catch (error) {
    console.error('Error getting current week:', error);
    // Fallback: check most recent week with scores
    try {
      const query = `
        SELECT MAX(week_number) as current_week
        FROM matchup_scores
        WHERE season_year = 2025
      `;
      const result = await db.query(query);
      return result && result[0]?.current_week ? result[0].current_week : 1;
    } catch (err) {
      console.error('Error getting fallback current week:', err);
      return 1;
    }
  }
}

/**
 * Display the public scoreboard page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScoreboard = async (req, res) => {
  try {
    const seasonYear = parseInt(req.query.season) || 2025;
    const weekNumber = parseInt(req.query.week) || await getCurrentWeek();

    // Get matchups for the week with team names
    const matchups = await WeeklySchedule.getWeekScheduleWithTeams(weekNumber, seasonYear);

    // Get scores for the week
    const scores = await MatchupScore.getScoresByWeek(weekNumber, seasonYear);

    // Map scores to matchups
    const scoresMap = {};
    scores.forEach(score => {
      scoresMap[score.schedule_id] = score;
    });

    // Add scores to matchups and determine winners
    const matchupsWithScores = matchups.map(matchup => {
      const score = scoresMap[matchup.schedule_id];
      const team1Score = score?.team_1_score ?? null;
      const team2Score = score?.team_2_score ?? null;

      let winner = null;
      if (team1Score !== null && team2Score !== null) {
        if (team1Score > team2Score) winner = 'team1';
        else if (team2Score > team1Score) winner = 'team2';
        else winner = 'tie';
      }

      return {
        ...matchup,
        team_1_score: team1Score,
        team_2_score: team2Score,
        has_score: score !== undefined,
        winner
      };
    });

    // Check for uploaded spreadsheet
    const spreadsheet = await WeekSpreadsheet.getSpreadsheetByWeek(weekNumber, seasonYear);

    // Get user's team if logged in
    let userTeam = null;
    if (req.session.user && req.session.user.team_id) {
      userTeam = { team_id: req.session.user.team_id };
    }

    res.render('scoreboard-manual/index', {
      title: `Week ${weekNumber} Scoreboard`,
      activePage: 'scoreboard-manual',
      matchups: matchupsWithScores,
      weekNumber,
      seasonYear,
      currentWeek: weekNumber,
      spreadsheet,
      userTeam,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading scoreboard:', error);
    req.flash('error_msg', 'Error loading scoreboard');
    res.redirect('/dashboard');
  }
};

/**
 * Download spreadsheet for a week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.downloadSpreadsheet = async (req, res) => {
  try {
    const { spreadsheetId } = req.params;

    const spreadsheet = await WeekSpreadsheet.getSpreadsheetById(parseInt(spreadsheetId));

    if (!spreadsheet) {
      return res.status(404).send('Spreadsheet not found');
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${spreadsheet.original_filename}"`);

    // Send file
    res.download(spreadsheet.file_path, spreadsheet.original_filename);
  } catch (error) {
    console.error('Error downloading spreadsheet:', error);
    res.status(500).send('Error downloading spreadsheet');
  }
};

/**
 * Get scoreboard data for AJAX requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScoreboardData = async (req, res) => {
  try {
    const weekNumber = parseInt(req.query.week);
    const seasonYear = parseInt(req.query.season) || 2025;

    // Get matchups for the week
    const matchups = await WeeklySchedule.getWeekScheduleWithTeams(weekNumber, seasonYear);

    // Get scores for the week
    const scores = await MatchupScore.getScoresByWeek(weekNumber, seasonYear);

    // Map scores to matchups
    const scoresMap = {};
    scores.forEach(score => {
      scoresMap[score.schedule_id] = score;
    });

    // Add scores to matchups and determine winners
    const matchupsWithScores = matchups.map(matchup => {
      const score = scoresMap[matchup.schedule_id];
      const team1Score = score?.team_1_score ?? null;
      const team2Score = score?.team_2_score ?? null;

      let winner = null;
      if (team1Score !== null && team2Score !== null) {
        if (team1Score > team2Score) winner = 'team1';
        else if (team2Score > team1Score) winner = 'team2';
        else winner = 'tie';
      }

      return {
        ...matchup,
        team_1_score: team1Score,
        team_2_score: team2Score,
        has_score: score !== undefined,
        winner
      };
    });

    // Check for spreadsheet
    const spreadsheet = await WeekSpreadsheet.getSpreadsheetByWeek(weekNumber, seasonYear);

    res.json({
      success: true,
      matchups: matchupsWithScores,
      spreadsheet: spreadsheet
    });
  } catch (error) {
    console.error('Error fetching scoreboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching scoreboard data'
    });
  }
};

module.exports = exports;
