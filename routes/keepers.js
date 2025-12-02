/**
 * Keeper Routes
 * Routes for managing fantasy team keepers
 */

const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const teamController = require('../controllers/teamController');

/**
 * @route   GET /keepers
 * @desc    Redirect to user's team keepers page
 * @access  Private
 */
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const FantasyTeam = require('../models/FantasyTeam');

    // For guests, redirect to their default team
    if (req.session.guest) {
      return res.redirect(`/keepers/${req.session.guestTeamId}`);
    }

    const userTeams = await FantasyTeam.findByUserId(req.session.user.id);

    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have any fantasy teams.');
      return res.redirect('/teams');
    }

    // Redirect to first team's keepers
    res.redirect(`/keepers/${userTeams[0].team_id}`);
  } catch (error) {
    console.error('Error in keepers redirect:', error);
    req.flash('error_msg', 'Error loading keeper page');
    res.redirect('/dashboard');
  }
});

/**
 * @route   GET /keepers/:teamId
 * @desc    Show keeper management page for specific team
 * @access  Private
 */
router.get('/:teamId', ensureAuthenticated, teamController.getTeamKeepers);

/**
 * @route   POST /keepers/:teamId
 * @desc    Update keepers for specific team
 * @access  Private
 */
router.post('/:teamId', ensureAuthenticated, teamController.updateKeepersFromKeeperPage);

module.exports = router;