/**
 * Playoff Lineup Controller
 * Handles Week 18 playoff lineup submissions
 */

const PlayoffLineupSubmission = require('../models/PlayoffLineupSubmission');
const PlayoffLineupPosition = require('../models/PlayoffLineupPosition');
const FantasyTeam = require('../models/FantasyTeam');
const db = require('../config/database');
const { validationResult } = require('express-validator');

/**
 * Display playoff lineup page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPlayoffLineups = async (req, res) => {
  try {
    const isGuest = req.session.guest;
    const seasonYear = 2025;

    // Get user's fantasy teams (or guest team)
    let userTeams;
    if (isGuest) {
      const guestTeamId = req.query.team || req.session.guestTeamId;
      const guestTeam = await FantasyTeam.findById(guestTeamId);
      userTeams = guestTeam ? [guestTeam] : [];
    } else {
      const userId = req.session.user.id;
      userTeams = await FantasyTeam.findByUserId(userId);
    }

    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have any fantasy teams.');
      return res.redirect('/teams');
    }

    // Use specified team or first team
    const teamId = req.query.team || userTeams[0].team_id;
    const selectedTeam = userTeams.find(t => t.team_id == teamId) || userTeams[0];

    // Get head coach's NFL team information
    if (selectedTeam.head_coach) {
      const coachTeamRows = await db.query(
        'SELECT team_name FROM nfl_teams WHERE head_coach = ?',
        [selectedTeam.head_coach]
      );
      if (coachTeamRows && coachTeamRows.length > 0) {
        selectedTeam.head_coach_team = coachTeamRows[0].team_name;
      }
    }

    // Get or create playoff lineup submission
    let playoffLineup = await PlayoffLineupSubmission.getByTeamAndSeason(teamId, seasonYear);

    if (!playoffLineup) {
      // Create new playoff lineup
      const playoffLineupId = await PlayoffLineupSubmission.createLineup({
        fantasy_team_id: teamId,
        season_year: seasonYear
      });

      playoffLineup = await PlayoffLineupSubmission.getByTeamAndSeason(teamId, seasonYear);
    }

    // Get Week 18 lock status
    const lockStatus = await PlayoffLineupSubmission.getWeek18LockStatus(seasonYear);

    // Get team's roster organized by position
    const rosterByPosition = await PlayoffLineupPosition.getTeamRosterByPosition(
      teamId,
      playoffLineup.playoff_lineup_id
    );

    // Get current playoff lineup positions
    const lineupByPosition = await PlayoffLineupPosition.getLineupPositions(
      playoffLineup.playoff_lineup_id
    );

    // Playoff round display names
    const playoffRounds = [
      { value: 'week18', label: 'Week 18' },
      { value: 'wildcard', label: 'Wild Card' },
      { value: 'divisional', label: 'Divisional Round' },
      { value: 'conference', label: 'Conference Championship' },
      { value: 'superbowl', label: 'Super Bowl' }
    ];

    res.render('lineups/playoff', {
      title: 'Week 18 Playoff Lineups',
      activePage: 'lineups',
      user: req.session.user,
      isGuest,
      userTeams,
      selectedTeam,
      playoffLineup,
      rosterByPosition,
      lineupByPosition,
      playoffRounds,
      lockStatus,
      seasonYear
    });

  } catch (error) {
    console.error('Error displaying playoff lineups:', error.message);
    req.flash('error_msg', 'Error loading playoff lineups');
    res.redirect('/lineups');
  }
};

/**
 * Save playoff lineup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.savePlayoffLineup = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { playoff_lineup_id, fantasy_team_id, positions } = req.body;
    const isGuest = req.session.guest;

    // Check permissions
    if (isGuest) {
      return res.status(403).json({
        success: false,
        message: 'Guest mode is read-only'
      });
    }

    // Verify user owns this team
    const userId = req.session.user.id;
    const userTeams = await FantasyTeam.findByUserId(userId);
    const ownsTeam = userTeams.some(t => t.team_id == fantasy_team_id);

    if (!ownsTeam) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this team'
      });
    }

    // Check if Week 18 is locked
    const lockStatus = await PlayoffLineupSubmission.getWeek18LockStatus();
    if (lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked') {
      return res.status(400).json({
        success: false,
        message: 'Week 18 playoff lineups are locked'
      });
    }

    // Save positions
    await PlayoffLineupPosition.saveLineupPositions(playoff_lineup_id, positions);

    // Log activity
    try {
      await db.query(
        `INSERT INTO activity_logs (user_id, action_type, description, entity_type, entity_id)
         VALUES (?, 'lineup_save', 'Saved Week 18 playoff lineup', 'playoff_lineup', ?)`,
        [userId, playoff_lineup_id]
      );
    } catch (logError) {
      console.warn('Could not log activity:', logError.message);
    }

    res.json({
      success: true,
      message: 'Playoff lineup saved successfully'
    });

  } catch (error) {
    console.error('Error saving playoff lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving playoff lineup',
      error: error.message
    });
  }
};

/**
 * Add player to playoff lineup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.addPlayerToLineup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      playoff_lineup_id,
      fantasy_team_id,
      player_id,
      playoff_round,
      position_type,
      player_status = 'rostered',
      waiver_request_id = null
    } = req.body;

    const isGuest = req.session.guest;

    if (isGuest) {
      return res.status(403).json({
        success: false,
        message: 'Guest mode is read-only'
      });
    }

    // Verify user owns this team
    const userId = req.session.user.id;
    const userTeams = await FantasyTeam.findByUserId(userId);
    const ownsTeam = userTeams.some(t => t.team_id == fantasy_team_id);

    if (!ownsTeam) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this team'
      });
    }

    // Check if Week 18 is locked
    const lockStatus = await PlayoffLineupSubmission.getWeek18LockStatus();
    if (lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked') {
      return res.status(400).json({
        success: false,
        message: 'Week 18 playoff lineups are locked'
      });
    }

    // Get current positions to determine next sort order
    const currentPositions = await PlayoffLineupPosition.getLineupPositions(playoff_lineup_id);
    const positionList = currentPositions[position_type] || [];
    const nextSortOrder = positionList.length + 1;

    // Add position
    await PlayoffLineupPosition.addPosition(playoff_lineup_id, {
      position_type,
      player_id,
      playoff_round,
      sort_order: nextSortOrder,
      player_status,
      waiver_request_id
    });

    res.json({
      success: true,
      message: 'Player added to playoff lineup'
    });

  } catch (error) {
    console.error('Error adding player to playoff lineup:', error);

    // Handle duplicate entry error
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'This player is already assigned to this playoff round'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error adding player to playoff lineup',
      error: error.message
    });
  }
};

/**
 * Remove player from playoff lineup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.removePlayerFromLineup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { playoff_lineup_id, fantasy_team_id, player_id, playoff_round } = req.body;
    const isGuest = req.session.guest;

    if (isGuest) {
      return res.status(403).json({
        success: false,
        message: 'Guest mode is read-only'
      });
    }

    // Verify user owns this team
    const userId = req.session.user.id;
    const userTeams = await FantasyTeam.findByUserId(userId);
    const ownsTeam = userTeams.some(t => t.team_id == fantasy_team_id);

    if (!ownsTeam) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this team'
      });
    }

    // Check if Week 18 is locked
    const lockStatus = await PlayoffLineupSubmission.getWeek18LockStatus();
    if (lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked') {
      return res.status(400).json({
        success: false,
        message: 'Week 18 playoff lineups are locked'
      });
    }

    // Remove position
    await PlayoffLineupPosition.removePosition(playoff_lineup_id, player_id, playoff_round);

    res.json({
      success: true,
      message: 'Player removed from playoff lineup'
    });

  } catch (error) {
    console.error('Error removing player from playoff lineup:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing player from playoff lineup',
      error: error.message
    });
  }
};

/**
 * Reorder positions via drag and drop
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.reorderPositions = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { playoff_lineup_id, fantasy_team_id, position_type, new_order } = req.body;
    const isGuest = req.session.guest;

    if (isGuest) {
      return res.status(403).json({
        success: false,
        message: 'Guest mode is read-only'
      });
    }

    // Verify user owns this team
    const userId = req.session.user.id;
    const userTeams = await FantasyTeam.findByUserId(userId);
    const ownsTeam = userTeams.some(t => t.team_id == fantasy_team_id);

    if (!ownsTeam) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this team'
      });
    }

    // Check if Week 18 is locked
    const lockStatus = await PlayoffLineupSubmission.getWeek18LockStatus();
    if (lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked') {
      return res.status(400).json({
        success: false,
        message: 'Week 18 playoff lineups are locked'
      });
    }

    // Update sort order
    await PlayoffLineupPosition.updateSortOrder(playoff_lineup_id, position_type, new_order);

    res.json({
      success: true,
      message: 'Position order updated'
    });

  } catch (error) {
    console.error('Error reordering positions:', error);
    res.status(500).json({
      success: false,
      message: 'Error reordering positions',
      error: error.message
    });
  }
};

module.exports = exports;
