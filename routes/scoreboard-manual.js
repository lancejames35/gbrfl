/**
 * Manual Scoreboard Routes
 * Public routes for viewing manually entered scores
 */

const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const manualScoreboardController = require('../controllers/manualScoreboardController');

/**
 * @route   GET /scoreboard-results
 * @desc    Display public scoreboard with manual scores
 * @access  Private
 */
router.get('/', ensureAuthenticated, manualScoreboardController.getScoreboard);

/**
 * @route   GET /scoreboard-results/data
 * @desc    Get scoreboard data for AJAX requests
 * @access  Private
 */
router.get('/data', ensureAuthenticated, manualScoreboardController.getScoreboardData);

/**
 * @route   GET /scoreboard-results/download/:spreadsheetId
 * @desc    Download spreadsheet for a week
 * @access  Private
 */
router.get('/download/:spreadsheetId', ensureAuthenticated, manualScoreboardController.downloadSpreadsheet);

module.exports = router;
