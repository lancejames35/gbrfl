const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const db = require('../config/database');

/**
 * @route   GET /profile
 * @desc    View user profile page
 * @access  Private
 */
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    // Get user info with profile data
    const [user] = await db.query(`
      SELECT u.*, nt.team_name as favorite_team_name
      FROM users u
      LEFT JOIN nfl_teams nt ON u.favorite_nfl_team = nt.nfl_team_id
      WHERE u.user_id = ?
    `, [req.user.id]);

    // Get user's fantasy team info
    const [fantasyTeam] = await db.query(`
      SELECT ft.*, 
             (SELECT COUNT(*) FROM fantasy_team_players ftp WHERE ftp.fantasy_team_id = ft.team_id) as roster_count
      FROM fantasy_teams ft 
      WHERE ft.user_id = ?
    `, [req.user.id]);

    // Get recent activity (last 10 transactions)
    const recentActivity = await db.query(`
      SELECT al.*, ft.team_name
      FROM activity_logs al
      LEFT JOIN fantasy_teams ft ON al.user_id = ft.user_id
      WHERE al.user_id = ?
      ORDER BY al.created_at DESC
      LIMIT 10
    `, [req.user.id]);

    // Get trade history - simplified query to avoid GROUP BY issues
    const tradeHistory = await db.query(`
      SELECT DISTINCT t.trade_id, t.proposal_date, t.status, t.completion_date, t.notes
      FROM trades t
      JOIN trade_items ti ON t.trade_id = ti.trade_id
      JOIN fantasy_teams ft ON (ti.from_team_id = ft.team_id OR ti.to_team_id = ft.team_id)
      WHERE ft.user_id = ?
      AND t.status IN ('Accepted', 'Completed')
      ORDER BY t.completion_date DESC
      LIMIT 5
    `, [req.user.id]);

    // Get achievements/stats
    const achievements = await db.query(`
      SELECT * FROM user_achievements 
      WHERE user_id = ? 
      ORDER BY achieved_at DESC
    `, [req.user.id]);

    res.render('profile/index', {
      title: 'My Profile | GBRFL',
      user: req.user,
      profile: user,
      fantasyTeam,
      recentActivity,
      tradeHistory,
      achievements,
      activePage: 'profile'
    });
  } catch (error) {
    console.error('Error loading profile page:', error);
    req.flash('error_msg', 'Error loading profile');
    res.redirect('/dashboard');
  }
});

module.exports = router;