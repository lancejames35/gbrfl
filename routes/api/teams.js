/**
 * API Routes for Teams
 * Handles API endpoints related to fantasy teams
 */

const express = require('express');
const router = express.Router();
const teamController = require('../../controllers/teamController');
const { ensureAuthenticated } = require('../../middleware/auth');

/**
 * @route   GET /api/teams
 * @desc    Get all teams
 * @access  Private
 */
router.get('/', ensureAuthenticated, teamController.getAllTeams);

/**
 * @route   GET /api/teams/my-teams
 * @desc    Get the user's teams
 * @access  Private
 */
router.get('/my-teams', ensureAuthenticated, teamController.getMyTeams);

/**
 * @route   GET /api/teams/players/available 
 * @desc    Get available players (not on any roster)
 * @access  Private
 */
router.get('/players/available', ensureAuthenticated, teamController.getAvailablePlayers);

/**
 * @route   GET /api/teams/my-roster
 * @desc    Get the current user's roster
 * @access  Private
 */
router.get('/my-roster', ensureAuthenticated, teamController.getMyRoster);

/**
 * @route   GET /api/teams/:id
 * @desc    Get a specific team by ID
 * @access  Private
 */
router.get('/:id', ensureAuthenticated, teamController.getTeamById);

/**
 * @route   POST /api/teams/:id/add-player
 * @desc    Add a player to a team's roster
 * @access  Private
 */
router.post('/:id/add-player', ensureAuthenticated, teamController.addPlayerToTeam);

/**
 * @route   POST /api/teams/:id/remove-player
 * @desc    Remove a player from a team's roster
 * @access  Private
 */
router.post('/:id/remove-player', ensureAuthenticated, teamController.removePlayerFromTeam);

/**
 * @route   POST /api/teams/:id/toggle-keeper
 * @desc    Toggle a player's keeper status
 * @access  Private
 */
router.post('/:id/toggle-keeper', ensureAuthenticated, teamController.toggleKeeperStatus);

module.exports = router;