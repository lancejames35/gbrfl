const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const UserPreference = require('../models/UserPreference');
const Notification = require('../models/Notification');
const db = require('../config/database');

/**
 * @route   GET /settings
 * @desc    View settings page
 * @access  Private
 */
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    // Get user preferences
    const preferences = await UserPreference.getAll(req.user.id);
    
    // Get notification preferences
    const notificationPrefs = await Notification.getUserPreferences(req.user.id);
    
    // Get NFL teams for favorite team dropdown
    const nflTeams = await db.query('SELECT * FROM nfl_teams ORDER BY team_name');
    
    // Get current user info including profile fields
    const [currentUser] = await db.query(
      'SELECT * FROM users WHERE user_id = ?', 
      [req.user.id]
    );
    
    res.render('settings/index', {
      title: 'Settings | GBRFL',
      user: req.user,
      currentUser,
      preferences,
      notificationPrefs,
      nflTeams,
      activePage: 'settings'
    });
  } catch (error) {
    console.error('Error loading settings page:', error);
    req.flash('error_msg', 'Error loading settings');
    res.redirect('/dashboard');
  }
});

module.exports = router;