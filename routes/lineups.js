/**
 * Lineup Routes
 * Handles fantasy football lineup submission routes
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const { ensureAuthenticated } = require('../middleware/auth');
const lineupController = require('../controllers/lineupController');

// All lineup routes require authentication
router.use(ensureAuthenticated);

/**
 * @route   GET /lineups
 * @desc    Main lineup page (redirects to current week)
 * @access  Private
 */
router.get('/', lineupController.getLineups);

/**
 * @route   GET /lineups/week/:week/:gameType?
 * @desc    Display lineups for specific week and game type
 * @access  Private
 */
router.get('/week/:week/:gameType?', lineupController.getLineupsForWeek);

/**
 * @route   POST /lineups/save
 * @desc    Save lineup (auto-save functionality)
 * @access  Private
 */
router.post('/save', [
  check('lineup_id').isInt().withMessage('Invalid lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID'),
  check('week_number').isInt({ min: 1, max: 17 }).withMessage('Week must be between 1 and 17'),
  check('game_type').isIn(['primary', 'bonus']).withMessage('Game type must be primary or bonus'),
  check('positions').isArray().withMessage('Positions must be an array'),
  check('status').optional().isIn(['draft', 'submitted']).withMessage('Invalid status')
], lineupController.saveLineup);

/**
 * @route   POST /lineups/submit
 * @desc    Submit final lineup
 * @access  Private
 */
router.post('/submit', [
  check('lineup_id').isInt().withMessage('Invalid lineup ID')
], lineupController.submitLineup);

/**
 * @route   POST /lineups/copy
 * @desc    Copy lineup from another week/game
 * @access  Private
 */
router.post('/copy', [
  check('source_week').isInt({ min: 1, max: 17 }).withMessage('Source week must be between 1 and 17'),
  check('source_game_type').isIn(['primary', 'bonus']).withMessage('Source game type must be primary or bonus'),
  check('target_lineup_id').isInt().withMessage('Invalid target lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID')
], lineupController.copyLineup);

/**
 * @route   POST /lineups/copy-previous
 * @desc    Copy lineup from previous week
 * @access  Private
 */
router.post('/copy-previous', [
  check('target_lineup_id').isInt().withMessage('Invalid target lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID'),
  check('current_week').isInt({ min: 1, max: 17 }).withMessage('Current week must be between 1 and 17'),
  check('game_type').isIn(['primary', 'bonus']).withMessage('Game type must be primary or bonus')
], lineupController.copyFromPreviousWeek);

/**
 * @route   POST /lineups/reset
 * @desc    Reset lineup to empty state
 * @access  Private
 */
router.post('/reset', [
  check('lineup_id').isInt().withMessage('Invalid lineup ID')
], lineupController.resetLineup);

/**
 * @route   POST /lineups/reorder
 * @desc    Reorder positions via drag and drop
 * @access  Private
 */
router.post('/reorder', [
  check('lineup_id').isInt().withMessage('Invalid lineup ID'),
  check('position_type').isIn(['quarterback', 'running_back', 'receiver', 'place_kicker', 'defense']).withMessage('Invalid position type'),
  check('new_order').isArray().withMessage('New order must be an array')
], lineupController.reorderPositions);

/**
 * @route   GET /lineups/players/:team_id/:position_type
 * @desc    Get available players for a position
 * @access  Private
 */
router.get('/players/:team_id/:position_type', lineupController.getPlayerPool);

/**
 * @route   GET /lineups/validate/:lineup_id
 * @desc    Validate lineup completion
 * @access  Private
 */
router.get('/validate/:lineup_id', lineupController.validateLineup);

/**
 * @route   POST /lineups/save-head-coach
 * @desc    Save head coach selection for lineup
 * @access  Private
 */
router.post('/save-head-coach', [
  check('lineup_id').isInt().withMessage('Invalid lineup ID'),
  check('head_coach').optional().isLength({ max: 100 }).withMessage('Head coach name too long')
], lineupController.saveHeadCoach);

module.exports = router;