/**
 * Admin Scoreboard Controller
 * Handles admin functionality for entering scores and uploading spreadsheets
 */

const MatchupScore = require('../models/MatchupScore');
const WeekSpreadsheet = require('../models/WeekSpreadsheet');
const WeeklySchedule = require('../models/WeeklySchedule');
const ScheduleAssignment = require('../models/ScheduleAssignment');
const db = require('../config/database');
const path = require('path');
const fs = require('fs').promises;

/**
 * Display score entry page for a specific week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScoreEntryPage = async (req, res) => {
  try {
    const seasonYear = parseInt(req.query.season) || 2025;
    const weekNumber = parseInt(req.query.week) || 1;

    // Get matchups for the week
    const matchups = await WeeklySchedule.getWeekScheduleWithTeams(weekNumber, seasonYear);

    // Get existing scores for the week
    const existingScores = await MatchupScore.getScoresByWeek(weekNumber, seasonYear);

    // Map scores to matchups
    const scoresMap = {};
    existingScores.forEach(score => {
      scoresMap[score.schedule_id] = score;
    });

    // Add scores to matchups
    const matchupsWithScores = matchups.map(matchup => ({
      ...matchup,
      team_1_score: scoresMap[matchup.schedule_id]?.team_1_score ?? null,
      team_2_score: scoresMap[matchup.schedule_id]?.team_2_score ?? null,
      has_score: !!scoresMap[matchup.schedule_id]
    }));

    // Check for uploaded spreadsheet
    const spreadsheet = await WeekSpreadsheet.getSpreadsheetByWeek(weekNumber, seasonYear);

    res.render('admin/scoreboard-scores', {
      title: `Week ${weekNumber} Scores - Admin`,
      activePage: 'admin',
      matchups: matchupsWithScores,
      weekNumber,
      seasonYear,
      spreadsheet,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading score entry page:', error);
    req.flash('error_msg', 'Error loading score entry page');
    res.redirect('/admin');
  }
};

/**
 * Save scores for a week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveScores = async (req, res) => {
  try {
    const { scores, weekNumber, seasonYear } = req.body;
    const userId = req.session.user.id;

    if (!scores || !Array.isArray(scores)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid scores data'
      });
    }

    // Prepare scores for batch upsert
    const scoresArray = scores.map(score => ({
      schedule_id: parseInt(score.schedule_id),
      week_number: parseInt(weekNumber),
      season_year: parseInt(seasonYear),
      game_type: score.game_type,
      team_1_score: parseInt(score.team_1_score) || 0,
      team_2_score: parseInt(score.team_2_score) || 0,
      updated_by: userId
    }));

    // Batch upsert scores
    await MatchupScore.batchUpsertScores(scoresArray);

    res.json({
      success: true,
      message: `Scores saved for Week ${weekNumber}`
    });
  } catch (error) {
    console.error('Error saving scores:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving scores'
    });
  }
};

/**
 * Upload spreadsheet for a week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.uploadSpreadsheet = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { weekNumber, seasonYear } = req.body;
    const userId = req.session.user.id;

    // Prepare spreadsheet data
    const spreadsheetData = {
      week_number: parseInt(weekNumber),
      season_year: parseInt(seasonYear),
      original_filename: req.file.originalname,
      stored_filename: req.file.filename,
      file_path: req.file.path,
      file_size: req.file.size,
      uploaded_by: userId
    };

    // Save to database
    const result = await WeekSpreadsheet.uploadSpreadsheet(spreadsheetData);

    res.json({
      success: true,
      message: `Spreadsheet uploaded for Week ${weekNumber}`,
      spreadsheet_id: result.spreadsheet_id
    });
  } catch (error) {
    console.error('Error uploading spreadsheet:', error);

    // Clean up uploaded file on error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Error uploading spreadsheet'
    });
  }
};

/**
 * Delete spreadsheet for a week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deleteSpreadsheet = async (req, res) => {
  try {
    const { spreadsheetId } = req.params;

    await WeekSpreadsheet.deleteSpreadsheet(parseInt(spreadsheetId));

    res.json({
      success: true,
      message: 'Spreadsheet deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting spreadsheet:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting spreadsheet'
    });
  }
};

/**
 * Get scores data for AJAX
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScoresData = async (req, res) => {
  try {
    const weekNumber = parseInt(req.query.week);
    const seasonYear = parseInt(req.query.season) || 2025;

    // Get matchups for the week
    const matchups = await WeeklySchedule.getWeekScheduleWithTeams(weekNumber, seasonYear);

    // Get existing scores
    const existingScores = await MatchupScore.getScoresByWeek(weekNumber, seasonYear);

    // Map scores to matchups
    const scoresMap = {};
    existingScores.forEach(score => {
      scoresMap[score.schedule_id] = score;
    });

    // Add scores to matchups
    const matchupsWithScores = matchups.map(matchup => ({
      ...matchup,
      team_1_score: scoresMap[matchup.schedule_id]?.team_1_score ?? null,
      team_2_score: scoresMap[matchup.schedule_id]?.team_2_score ?? null,
      has_score: !!scoresMap[matchup.schedule_id]
    }));

    res.json({
      success: true,
      matchups: matchupsWithScores
    });
  } catch (error) {
    console.error('Error fetching scores data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching scores data'
    });
  }
};

module.exports = exports;
