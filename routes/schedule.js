const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const scheduleController = require('../controllers/scheduleController');

/**
 * @route   GET /schedule
 * @desc    Show league schedule page
 * @access  Private
 */
router.get('/', ensureAuthenticated, scheduleController.getSchedulePage);

/**
 * @route   GET /schedule/data
 * @desc    Get schedule data for AJAX requests
 * @access  Private
 */
router.get('/data', ensureAuthenticated, scheduleController.getScheduleData);

/**
 * @route   GET /schedule/stats
 * @desc    Get schedule statistics
 * @access  Private
 */
router.get('/stats', ensureAuthenticated, scheduleController.getScheduleStats);

module.exports = router;