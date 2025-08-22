/**
 * Team Routes
 * Handles all routes related to fantasy teams
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const teamController = require('../controllers/teamController');
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /teams
 * @desc    Redirect to user's team roster or team selection page
 * @access  Private
 */
router.get('/', ensureAuthenticated, teamController.redirectToUserTeam);

/**
 * @route   GET /teams/all
 * @desc    Get all teams (moved from root route)
 * @access  Private
 */
router.get('/all', ensureAuthenticated, teamController.getAllTeams);

/**
 * @route   GET /teams/my-teams
 * @desc    Get the user's teams
 * @access  Private
 */
router.get('/my-teams', ensureAuthenticated, teamController.getMyTeams);

/**
 * @route   GET /teams/create
 * @desc    Show create team form
 * @access  Private
 */
router.get('/create', ensureAuthenticated, teamController.showCreateForm);

/**
 * @route   POST /teams
 * @desc    Create a new team
 * @access  Private
 */
router.post('/', ensureAuthenticated, [
  check('teamName', 'Team name is required').not().isEmpty()
], teamController.createTeam);

/**
 * @route   GET /teams/:id
 * @desc    Get a specific team by ID
 * @access  Private
 */
router.get('/:id', ensureAuthenticated, teamController.getTeamById);

/**
 * @route   GET /teams/:id/edit
 * @desc    Show edit team form
 * @access  Private
 */
router.get('/:id/edit', ensureAuthenticated, teamController.showEditForm);

/**
 * @route   PUT /teams/:id
 * @desc    Update a team
 * @access  Private
 */
router.put('/:id', ensureAuthenticated, [
  check('teamName', 'Team name is required').not().isEmpty()
], teamController.updateTeam);

/**
 * @route   POST /teams/:id
 * @desc    Handle form submission for update (HTML forms don't support PUT)
 * @access  Private
 */
router.post('/:id', ensureAuthenticated, [
  check('teamName', 'Team name is required').not().isEmpty()
], teamController.updateTeam);

/**
 * @route   POST /teams/:id/add-player
 * @desc    Add a player to a team's roster
 * @access  Private
 */
router.post('/:id/add-player', ensureAuthenticated, teamController.addPlayerToTeam);

/**
 * @route   POST /teams/:id/remove-player
 * @desc    Remove a player from a team's roster
 * @access  Private
 */
router.post('/:id/remove-player', ensureAuthenticated, teamController.removePlayerFromTeam);

/**
 * @route   POST /teams/:id/toggle-keeper
 * @desc    Toggle a player's keeper status
 * @access  Private
 */
router.post('/:id/toggle-keeper', ensureAuthenticated, teamController.toggleKeeperStatus);

/**
 * @route   POST /teams/:id/keepers
 * @desc    Update keeper selections for a team
 * @access  Private
 */
router.post('/:id/keepers', ensureAuthenticated, teamController.updateKeepers);

module.exports = router;