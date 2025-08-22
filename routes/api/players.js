/**
 * API Player Routes
 * Handles all API routes related to NFL players
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const playerController = require('../../controllers/playerController');
const { authenticate } = require('../../middleware/auth');

/**
 * @route   GET /api/players
 * @desc    Get all players with pagination and filtering
 * @access  Private
 */
router.get('/', authenticate, playerController.getAllPlayers);

/**
 * @route   POST /api/players
 * @desc    Create a new player
 * @access  Private
 */
router.post('/', authenticate, [
  check('firstName', 'First name is required').not().isEmpty(),
  check('lastName', 'Last name is required').not().isEmpty(),
  check('position', 'Position is required').not().isEmpty()
], playerController.createPlayer);

/**
 * @route   GET /api/players/available
 * @desc    Get available players (not on any fantasy team)
 * @access  Private
 */
router.get('/available', authenticate, playerController.getAvailablePlayers);

/**
 * @route   GET /api/players/:id
 * @desc    Get a single player by ID
 * @access  Private
 */
router.get('/:id', authenticate, playerController.getPlayerById);

/**
 * @route   PUT /api/players/:id
 * @desc    Update a player
 * @access  Private
 */
router.put('/:id', authenticate, [
  check('firstName', 'First name is required').not().isEmpty(),
  check('lastName', 'Last name is required').not().isEmpty(),
  check('position', 'Position is required').not().isEmpty()
], playerController.updatePlayer);

/**
 * @route   DELETE /api/players/:id
 * @desc    Delete a player
 * @access  Private
 */
router.delete('/:id', authenticate, playerController.deletePlayer);

module.exports = router;