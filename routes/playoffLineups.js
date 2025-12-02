/**
 * Playoff Lineup Routes
 * Handles Week 18 playoff lineup submission routes
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const { ensureAuthenticated } = require('../middleware/auth');
const playoffLineupController = require('../controllers/playoffLineupController');

// All playoff lineup routes require authentication
router.use(ensureAuthenticated);

/**
 * @route   GET /playoff-lineups
 * @desc    Display Week 18 playoff lineup page
 * @access  Private
 */
router.get('/', playoffLineupController.getPlayoffLineups);

/**
 * @route   POST /playoff-lineups/save
 * @desc    Save playoff lineup
 * @access  Private
 */
router.post('/save', [
  check('playoff_lineup_id').isInt().withMessage('Invalid playoff lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID'),
  check('positions').isArray().withMessage('Positions must be an array')
], playoffLineupController.savePlayoffLineup);

/**
 * @route   POST /playoff-lineups/add-player
 * @desc    Add player to playoff lineup
 * @access  Private
 */
router.post('/add-player', [
  check('playoff_lineup_id').isInt().withMessage('Invalid playoff lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID'),
  check('player_id').isInt().withMessage('Invalid player ID'),
  check('playoff_round').isIn(['week18', 'wildcard', 'divisional', 'conference', 'superbowl'])
    .withMessage('Invalid playoff round'),
  check('position_type').isIn(['quarterback', 'running_back', 'receiver', 'place_kicker', 'defense'])
    .withMessage('Invalid position type')
], playoffLineupController.addPlayerToLineup);

/**
 * @route   POST /playoff-lineups/remove-player
 * @desc    Remove player from playoff lineup
 * @access  Private
 */
router.post('/remove-player', [
  check('playoff_lineup_id').isInt().withMessage('Invalid playoff lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID'),
  check('player_id').isInt().withMessage('Invalid player ID'),
  check('playoff_round').isIn(['week18', 'wildcard', 'divisional', 'conference', 'superbowl'])
    .withMessage('Invalid playoff round')
], playoffLineupController.removePlayerFromLineup);

/**
 * @route   POST /playoff-lineups/reorder
 * @desc    Reorder positions via drag and drop
 * @access  Private
 */
router.post('/reorder', [
  check('playoff_lineup_id').isInt().withMessage('Invalid playoff lineup ID'),
  check('fantasy_team_id').isInt().withMessage('Invalid team ID'),
  check('position_type').isIn(['quarterback', 'running_back', 'receiver', 'place_kicker', 'defense'])
    .withMessage('Invalid position type'),
  check('new_order').isArray().withMessage('New order must be an array')
], playoffLineupController.reorderPositions);

module.exports = router;
