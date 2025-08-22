/**
 * Lineup Controller
 * Handles fantasy football lineup submissions and management
 */

const LineupSubmission = require('../models/LineupSubmission');
const LineupPosition = require('../models/LineupPosition');
const LineupLock = require('../models/LineupLock');
const FantasyTeam = require('../models/Fantasyteam');
const WeeklySchedule = require('../models/WeeklySchedule');
const db = require('../config/database');
const { validationResult } = require('express-validator');

/**
 * Display main lineup page (current week default)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getLineups = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const currentWeek = getCurrentWeek();
    
    // Get user's fantasy teams
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have any fantasy teams.');
      return res.redirect('/teams');
    }

    // Use first team or specified team
    const teamId = req.query.team || userTeams[0].team_id;
    const selectedTeam = userTeams.find(t => t.team_id == teamId) || userTeams[0];

    // Redirect to current week with default game type
    res.redirect(`/lineups/week/${currentWeek}/primary?team=${selectedTeam.team_id}`);
  } catch (error) {
    console.error('Error displaying lineups:', error.message);
    req.flash('error_msg', 'Error loading lineups');
    res.redirect('/dashboard');
  }
};

/**
 * Display lineups for specific week and game type
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getLineupsForWeek = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const weekNumber = parseInt(req.params.week);
    const gameType = req.params.gameType || 'primary';
    const seasonYear = 2025;

    // Validate week number
    if (weekNumber < 1 || weekNumber > 17) {
      req.flash('error_msg', 'Invalid week number');
      return res.redirect('/lineups');
    }

    // Get user's fantasy teams
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have any fantasy teams.');
      return res.redirect('/teams');
    }

    // Use specified team or first team
    const teamId = req.query.team || userTeams[0].team_id;
    const selectedTeam = userTeams.find(t => t.team_id == teamId) || userTeams[0];

    // Get or create lineup submission
    let lineup = await LineupSubmission.getByTeamAndWeek(selectedTeam.team_id, weekNumber, gameType, seasonYear);
    
    if (!lineup) {
      // Create new lineup if it doesn't exist
      const lineupId = await LineupSubmission.createLineup({
        fantasy_team_id: selectedTeam.team_id,
        week_number: weekNumber,
        game_type: gameType,
        season_year: seasonYear
      });
      
      lineup = await LineupSubmission.getByTeamAndWeek(selectedTeam.team_id, weekNumber, gameType, seasonYear);
    }

    // Get team roster organized by position with current lineup order
    const rosterByPosition = await LineupPosition.getTeamRosterByPosition(selectedTeam.team_id, lineup.lineup_id);

    // Get lock status
    const lockStatus = await LineupLock.getLockStatus(weekNumber, gameType, seasonYear);

    // Check lineup completion
    const completionStatus = await LineupSubmission.isLineupComplete(lineup.lineup_id);

    // Check if bonus games are available for this week
    const weekSchedule = await WeeklySchedule.getScheduleByWeek(weekNumber, seasonYear);
    const hasBonusGames = weekSchedule.some(game => game.game_type === 'bonus');

    // Get all weeks for navigation
    const allWeeks = Array.from({ length: 17 }, (_, i) => ({
      number: i + 1,
      label: `Week ${i + 1}`,
      active: i + 1 === weekNumber
    }));

    res.render('lineups/index', {
      title: `Lineups - Week ${weekNumber} ${gameType === 'bonus' ? 'Bonus' : 'Primary'}`,
      user: req.session.user,
      activePage: 'lineups',
      lineup,
      rosterByPosition,
      lockStatus,
      completionStatus,
      selectedTeam,
      userTeams,
      weekNumber,
      gameType,
      seasonYear,
      allWeeks,
      currentWeek: getCurrentWeek(),
      hasBonusGames
    });
  } catch (error) {
    console.error('Error displaying week lineups:', error.message);
    req.flash('error_msg', 'Error loading lineups for this week');
    res.redirect('/lineups');
  }
};

/**
 * Save lineup (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveLineup = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { lineup_id, positions, status = 'draft' } = req.body;

    // Verify lineup belongs to user
    const lineup = await LineupSubmission.getByTeamAndWeek(
      req.body.fantasy_team_id,
      req.body.week_number,
      req.body.game_type,
      req.body.season_year || 2025
    );

    if (!lineup || lineup.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this lineup'
      });
    }

    // Check if lineup is locked
    const lockStatus = await LineupLock.getLockStatus(
      req.body.week_number,
      req.body.game_type,
      req.body.season_year || 2025
    );

    if (lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked') {
      return res.status(400).json({
        success: false,
        message: 'Lineup is locked and cannot be modified'
      });
    }

    // Update positions
    await LineupPosition.updatePositions(lineup.lineup_id, positions);

    // Update lineup status if specified
    if (status === 'submitted') {
      await LineupSubmission.updateLineup(lineup.lineup_id, {
        submitted_at: new Date()
      });
    }

    // Check completion status
    const completionStatus = await LineupSubmission.isLineupComplete(lineup.lineup_id);

    res.json({
      success: true,
      message: 'Lineup saved successfully',
      completionStatus
    });
  } catch (error) {
    console.error('Error saving lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving lineup: ' + error.message
    });
  }
};

/**
 * Submit final lineup (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.submitLineup = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { lineup_id } = req.body;

    // Get lineup details
    const lineup = await db.query(`
      SELECT ls.*, ft.user_id
      FROM lineup_submissions ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      WHERE ls.lineup_id = ?
    `, [lineup_id]);

    if (lineup.length === 0 || lineup[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this lineup'
      });
    }

    const lineupData = lineup[0];

    // Check if lineup is locked
    const lockStatus = await LineupLock.getLockStatus(
      lineupData.week_number,
      lineupData.game_type,
      lineupData.season_year
    );

    if (lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked') {
      return res.status(400).json({
        success: false,
        message: 'Lineup is locked and cannot be submitted'
      });
    }

    // Check if lineup is complete
    const completionStatus = await LineupSubmission.isLineupComplete(lineup_id);
    if (!completionStatus.isComplete) {
      return res.status(400).json({
        success: false,
        message: 'Lineup is incomplete. Please fill all required positions.',
        missing: completionStatus.missing
      });
    }

    // Submit lineup
    await LineupSubmission.updateLineup(lineup_id, {
      submitted_at: new Date()
    });

    res.json({
      success: true,
      message: 'Lineup submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting lineup: ' + error.message
    });
  }
};

/**
 * Copy lineup from another week/game (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.copyLineup = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const {
      source_week,
      source_game_type,
      target_lineup_id,
      fantasy_team_id,
      season_year = 2025,
      target_game_type = null
    } = req.body;

    let actualTargetLineupId = target_lineup_id;

    // If target_game_type is provided, get or create that lineup
    if (target_game_type && source_week) {
      let targetLineup = await LineupSubmission.getByTeamAndWeek(
        fantasy_team_id,
        source_week,
        target_game_type,
        season_year
      );

      if (!targetLineup) {
        // Create target lineup if it doesn't exist
        actualTargetLineupId = await LineupSubmission.createLineup({
          fantasy_team_id,
          week_number: source_week,
          game_type: target_game_type,
          season_year
        });
      } else {
        actualTargetLineupId = targetLineup.lineup_id;
      }
    } else if (target_lineup_id) {
      // Verify target lineup belongs to user
      const targetLineup = await db.query(`
        SELECT ls.*, ft.user_id
        FROM lineup_submissions ls
        JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
        WHERE ls.lineup_id = ?
      `, [target_lineup_id]);

      if (targetLineup.length === 0 || targetLineup[0].user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this lineup'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Must provide either target_lineup_id or target_game_type'
      });
    }

    // Get source lineup
    const sourceLineup = await LineupSubmission.getByTeamAndWeek(
      fantasy_team_id,
      source_week,
      source_game_type,
      season_year
    );

    if (!sourceLineup) {
      return res.status(404).json({
        success: false,
        message: 'Source lineup not found'
      });
    }

    // Clear existing positions first
    await db.query('DELETE FROM lineup_positions WHERE lineup_id = ?', [actualTargetLineupId]);

    // Copy positions
    await LineupPosition.copyPositionsFromLineup(sourceLineup.lineup_id, actualTargetLineupId);

    res.json({
      success: true,
      message: 'Lineup copied successfully'
    });
  } catch (error) {
    console.error('Error copying lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error copying lineup: ' + error.message
    });
  }
};

/**
 * Copy lineup from previous week (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.copyFromPreviousWeek = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const {
      target_lineup_id,
      fantasy_team_id,
      current_week,
      game_type,
      season_year = 2025
    } = req.body;

    // Verify target lineup belongs to user
    const targetLineup = await db.query(`
      SELECT ls.*, ft.user_id
      FROM lineup_submissions ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      WHERE ls.lineup_id = ?
    `, [target_lineup_id]);

    if (targetLineup.length === 0 || targetLineup[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this lineup'
      });
    }

    const previousWeek = current_week - 1;
    if (previousWeek < 1) {
      return res.status(400).json({
        success: false,
        message: 'No previous week available'
      });
    }

    // Get previous week lineup (same game type)
    const sourceLineup = await LineupSubmission.getByTeamAndWeek(
      fantasy_team_id,
      previousWeek,
      game_type,
      season_year
    );

    if (!sourceLineup) {
      return res.status(404).json({
        success: false,
        message: `No lineup found for Week ${previousWeek} ${game_type}`
      });
    }

    // Clear existing positions first
    await db.query('DELETE FROM lineup_positions WHERE lineup_id = ?', [target_lineup_id]);

    // Copy positions
    await LineupPosition.copyPositionsFromLineup(sourceLineup.lineup_id, target_lineup_id);

    res.json({
      success: true,
      message: `Lineup copied from Week ${previousWeek} ${game_type}`
    });
  } catch (error) {
    console.error('Error copying from previous week:', error);
    res.status(500).json({
      success: false,
      message: 'Error copying from previous week: ' + error.message
    });
  }
};

/**
 * Reset lineup to empty state (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.resetLineup = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { lineup_id } = req.body;

    // Verify lineup belongs to user
    const lineup = await db.query(`
      SELECT ls.*, ft.user_id
      FROM lineup_submissions ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      WHERE ls.lineup_id = ?
    `, [lineup_id]);

    if (lineup.length === 0 || lineup[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this lineup'
      });
    }

    // Clear all positions
    await db.query('DELETE FROM lineup_positions WHERE lineup_id = ?', [lineup_id]);

    // Reset status to draft
    await LineupSubmission.updateLineup(lineup_id, {
      submitted_at: null
    });

    res.json({
      success: true,
      message: 'Lineup reset successfully'
    });
  } catch (error) {
    console.error('Error resetting lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting lineup: ' + error.message
    });
  }
};

/**
 * Reorder positions via drag and drop (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.reorderPositions = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { lineup_id, position_type, new_order } = req.body;

    // Verify lineup belongs to user
    const lineup = await db.query(`
      SELECT ls.*, ft.user_id
      FROM lineup_submissions ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      WHERE ls.lineup_id = ?
    `, [lineup_id]);

    if (lineup.length === 0 || lineup[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this lineup'
      });
    }

    // Reorder positions
    await LineupPosition.reorderPositions(lineup_id, position_type, new_order);

    res.json({
      success: true,
      message: 'Positions reordered successfully'
    });
  } catch (error) {
    console.error('Error reordering positions:', error);
    res.status(500).json({
      success: false,
      message: 'Error reordering positions: ' + error.message
    });
  }
};

/**
 * Get player pool for a position (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPlayerPool = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { team_id, position_type } = req.params;

    // Verify team belongs to user
    const team = await FantasyTeam.findById(team_id);
    if (!team || team.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this team'
      });
    }

    // Get available players
    const players = await LineupPosition.getAvailablePlayersForPosition(team_id, position_type);

    res.json({
      success: true,
      players
    });
  } catch (error) {
    console.error('Error fetching player pool:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching players: ' + error.message
    });
  }
};

/**
 * Validate lineup completion (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.validateLineup = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { lineup_id } = req.params;

    // Verify lineup belongs to user
    const lineup = await db.query(`
      SELECT ls.*, ft.user_id
      FROM lineup_submissions ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      WHERE ls.lineup_id = ?
    `, [lineup_id]);

    if (lineup.length === 0 || lineup[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to this lineup'
      });
    }

    // Check completion status
    const completionStatus = await LineupSubmission.isLineupComplete(lineup_id);

    res.json({
      success: true,
      completionStatus
    });
  } catch (error) {
    console.error('Error validating lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error validating lineup: ' + error.message
    });
  }
};

/**
 * Helper function to get current NFL week
 * @returns {number} Current week number
 */
function getCurrentWeek() {
  // This is a simplified implementation
  // In a real application, you'd calculate this based on the NFL season schedule
  const now = new Date();
  const seasonStart = new Date('2025-09-05'); // Updated for 2025 season
  const weeksDiff = Math.floor((now - seasonStart) / (7 * 24 * 60 * 60 * 1000));
  
  return Math.max(1, Math.min(17, weeksDiff + 1));
}

module.exports = exports;