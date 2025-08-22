/**
 * Player Routes
 * Handles all routes related to NFL players
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const playerController = require('../controllers/playerController');
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /players
 * @desc    Get all players with pagination and filtering
 * @access  Private
 */
router.get('/', ensureAuthenticated, playerController.getAllPlayers);

/**
 * @route   GET /players/available
 * @desc    Get available players (not drafted/owned)
 * @access  Private
 */
router.get('/available', ensureAuthenticated, playerController.getAvailablePlayers);

/**
 * @route   GET /players/:id
 * @desc    Get a single player by ID
 * @access  Private
 */
router.get('/:id', ensureAuthenticated, playerController.getPlayerById);

/**
 * @route   GET /players/:id/edit
 * @desc    Show edit player form
 * @access  Private
 */
router.get('/:id/edit', ensureAuthenticated, playerController.showEditForm);

/**
 * @route   PUT /players/:id
 * @desc    Update a player
 * @access  Private
 */
router.put('/:id', ensureAuthenticated, [
  check('firstName', 'First name is required').not().isEmpty(),
  check('lastName', 'Last name is required').not().isEmpty(),
  check('position', 'Position is required').not().isEmpty()
], playerController.updatePlayer);

/**
 * @route   DELETE /players/:id
 * @desc    Delete a player
 * @access  Private
 */
router.delete('/:id', ensureAuthenticated, playerController.deletePlayer);

/**
 * @route   POST /players/:id
 * @desc    Handle form submission for update (HTML forms don't support PUT)
 * @access  Private
 */
router.post('/:id', ensureAuthenticated, [
  check('firstName', 'First name is required').not().isEmpty(),
  check('lastName', 'Last name is required').not().isEmpty(),
  check('position', 'Position is required').not().isEmpty()
], playerController.updatePlayer);

module.exports = router;