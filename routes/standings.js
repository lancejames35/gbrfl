const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const db = require('../config/database');

/**
 * @route   GET /standings
 * @desc    Show league standings page
 * @access  Private
 */
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const seasonYear = 2025;
    const isGuest = req.session.guest;
    // For guests, use null for user_id comparison (no team will be highlighted)
    const userId = isGuest ? null : req.session.user.id;

    // Get standings with team and user information
    const standings = await db.query(`
      SELECT
        ls.*,
        ft.team_name,
        u.first_name,
        u.last_name,
        u.user_id = ? as user_team
      FROM league_standings ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      WHERE ls.season_year = ?
      ORDER BY
        ls.position ASC
    `, [userId, seasonYear]);

    // Get last updated time
    const lastUpdatedResult = await db.query(`
      SELECT MAX(updated_at) as last_updated
      FROM league_standings
      WHERE season_year = ?
    `, [seasonYear]);

    const lastUpdated = lastUpdatedResult[0]?.last_updated;

    res.render('standings', {
      title: 'League Standings | GBRFL',
      activePage: 'standings',
      standings: standings,
      lastUpdated: lastUpdated,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading standings:', error);
    req.flash('error_msg', 'Error loading standings');
    res.redirect('/dashboard');
  }
});

module.exports = router;