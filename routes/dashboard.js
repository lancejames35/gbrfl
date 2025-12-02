/**
 * Dashboard Routes
 * Handles routes for the main dashboard and user profile
 */

const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const User = require('../models/user');
const FantasyTeam = require('../models/FantasyTeam');
const { parseDateInTimezone, createEndOfDayDate } = require('../utils/timezoneFix');

/**
 * @route   GET /dashboard
 * @desc    Show dashboard page
 * @access  Private
 */
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const db = require('../config/database');

    // Check current dates for conditional content
    const now = new Date();
    const draftDate = new Date('2025-08-31');
    const seasonStart = new Date('2025-09-04');

    // Determine current phase using timezone-aware keeper deadline check
    const isKeeperPeriodActive = !(await FantasyTeam.isKeeperDeadlinePassed());
    const isDraftDay = now.toDateString() === draftDate.toDateString();
    const isPostDraft = now > draftDate;

    let userTeam = null;

    // For guests, use guestTeamId; for logged-in users, use their user_id
    const isGuest = req.session.guest;
    let teamRows;

    if (isGuest) {
      // Guest mode: get team by team_id
      teamRows = await db.query(`
        SELECT
          ft.team_id,
          ft.team_name,
          ft.user_id,
          u.first_name,
          u.last_name,
          COALESCE(player_count.total_players, 0) as player_count,
          COALESCE(keeper_count.keepers_filled, 0) as keepers_filled,
          COALESCE(tks.base_slots + tks.additional_slots, 12) as protection_spots,
          do.pick_number as draft_position
        FROM fantasy_teams ft
        JOIN users u ON ft.user_id = u.user_id
        LEFT JOIN (
          SELECT fantasy_team_id, COUNT(*) as total_players
          FROM fantasy_team_players
          GROUP BY fantasy_team_id
        ) player_count ON ft.team_id = player_count.fantasy_team_id
        LEFT JOIN (
          SELECT fantasy_team_id, COUNT(*) as keepers_filled
          FROM fantasy_team_players
          WHERE is_keeper = 1
          GROUP BY fantasy_team_id
        ) keeper_count ON ft.team_id = keeper_count.fantasy_team_id
        LEFT JOIN team_keeper_slots tks ON ft.team_id = tks.fantasy_team_id
        LEFT JOIN draft_order do ON ft.team_id = do.fantasy_team_id AND do.round = 1
        WHERE ft.team_id = ?
      `, [req.session.guestTeamId]);
    } else {
      // Logged-in user: get team by user_id
      teamRows = await db.query(`
        SELECT
          ft.team_id,
          ft.team_name,
          ft.user_id,
          u.first_name,
          u.last_name,
          COALESCE(player_count.total_players, 0) as player_count,
          COALESCE(keeper_count.keepers_filled, 0) as keepers_filled,
          COALESCE(tks.base_slots + tks.additional_slots, 12) as protection_spots,
          do.pick_number as draft_position
        FROM fantasy_teams ft
        JOIN users u ON ft.user_id = u.user_id
        LEFT JOIN (
          SELECT fantasy_team_id, COUNT(*) as total_players
          FROM fantasy_team_players
          GROUP BY fantasy_team_id
        ) player_count ON ft.team_id = player_count.fantasy_team_id
        LEFT JOIN (
          SELECT fantasy_team_id, COUNT(*) as keepers_filled
          FROM fantasy_team_players
          WHERE is_keeper = 1
          GROUP BY fantasy_team_id
        ) keeper_count ON ft.team_id = keeper_count.fantasy_team_id
        LEFT JOIN team_keeper_slots tks ON ft.team_id = tks.fantasy_team_id
        LEFT JOIN draft_order do ON ft.team_id = do.fantasy_team_id AND do.round = 1
        WHERE ft.user_id = ?
      `, [req.session.user.id]);
    }
    
    if (teamRows.length > 0) {
      userTeam = teamRows[0];
    }
    
    // Calculate league stats (for potential future use)
    const leagueStats = await db.query(`
      SELECT
        COUNT(DISTINCT ft.team_id) as total_teams,
        COUNT(DISTINCT CASE WHEN keeper_count.total > 0 THEN ft.team_id END) as teams_with_keepers
      FROM fantasy_teams ft
      LEFT JOIN (
        SELECT fantasy_team_id, COUNT(*) as total
        FROM fantasy_team_players
        WHERE is_keeper = 1
        GROUP BY fantasy_team_id
      ) keeper_count ON ft.team_id = keeper_count.fantasy_team_id
    `);

    // Get league settings including trade deadline
    const leagueSettings = await db.query(`
      SELECT trade_deadline_date
      FROM league_settings
      WHERE season_year = 2025
      LIMIT 1
    `);

    res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      originalAdmin: req.session.originalAdmin,
      userTeam: userTeam,
      isKeeperPeriodActive: isKeeperPeriodActive,
      isDraftDay: isDraftDay,
      isPostDraft: isPostDraft,
      daysUntilDraft: Math.ceil((draftDate - now) / (1000 * 60 * 60 * 24)),
      leagueStats: leagueStats[0] || { total_teams: 10, teams_with_keepers: 0 },
      tradeDeadline: leagueSettings[0]?.trade_deadline_date || null
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      originalAdmin: req.session.originalAdmin,
      userTeam: null,
      isKeeperPeriodActive: true,
      isDraftDay: false,
      isPostDraft: false,
      daysUntilDraft: 16,
      leagueStats: { total_teams: 10, teams_with_keepers: 0 },
      tradeDeadline: null
    });
  }
});

/**
 * @route   GET /profile
 * @desc    Show user profile page
 * @access  Private
 */
router.get('/profile', ensureAuthenticated, async (req, res) => {
  try {
    // Get the full user data
    const user = await User.findById(req.session.user.id);
    
    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/dashboard');
    }
    
    res.render('profile', {
      title: 'My Profile',
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        createdAt: user.created_at,
        lastLogin: user.last_login,
        isAdmin: user.is_admin === 1
      },
      activePage: 'profile'
    });
  } catch (error) {
    console.error('Profile page error:', error.message);
    req.flash('error_msg', 'Error loading profile');
    res.redirect('/dashboard');
  }
});

/**
 * @route   GET /settings
 * @desc    Show user settings page
 * @access  Private
 */
router.get('/settings', ensureAuthenticated, (req, res) => {
  res.render('settings', {
    title: 'Account Settings',
    user: req.session.user,
    activePage: 'settings'
  });
});

/**
 * @route   POST /profile/update
 * @desc    Update user profile
 * @access  Private
 */
router.post('/profile/update', ensureAuthenticated, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    
    // Update user
    const updated = await User.update(req.session.user.id, {
      firstName,
      lastName,
      email
    });
    
    if (updated) {
      // Update session data
      req.session.user.firstName = firstName;
      req.session.user.lastName = lastName;
      
      req.flash('success_msg', 'Profile updated successfully');
    } else {
      req.flash('error_msg', 'Error updating profile');
    }
    
    res.redirect('/profile');
  } catch (error) {
    console.error('Profile update error:', error.message);
    req.flash('error_msg', 'Error updating profile');
    res.redirect('/profile');
  }
});

/**
 * @route   POST /password/change
 * @desc    Change user password
 * @access  Private
 */
router.post('/password/change', ensureAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Check if new password and confirm password match
    if (newPassword !== confirmPassword) {
      req.flash('error_msg', 'New passwords do not match');
      return res.redirect('/settings');
    }
    
    // Get the user with password hash
    const user = await User.findById(req.session.user.id);
    
    // Check current password
    const isMatch = await User.comparePassword(currentPassword, user.password_hash);
    if (!isMatch) {
      req.flash('error_msg', 'Current password is incorrect');
      return res.redirect('/settings');
    }
    
    // Update password
    const updated = await User.update(req.session.user.id, {
      password: newPassword
    });
    
    if (updated) {
      req.flash('success_msg', 'Password changed successfully');
    } else {
      req.flash('error_msg', 'Error changing password');
    }
    
    res.redirect('/settings');
  } catch (error) {
    console.error('Password change error:', error.message);
    req.flash('error_msg', 'Error changing password');
    res.redirect('/settings');
  }
});

module.exports = router;