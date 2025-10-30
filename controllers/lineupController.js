/**
 * Lineup Controller
 * Handles fantasy football lineup submissions and management
 */

const LineupSubmission = require('../models/LineupSubmission');
const LineupPosition = require('../models/LineupPosition');
const LineupLock = require('../models/LineupLock');
const FantasyTeam = require('../models/FantasyTeam');
const WeeklySchedule = require('../models/WeeklySchedule');
const NFLTeam = require('../models/nflTeam');
const WeekStatus = require('../models/WeekStatus');
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
    const nextUnlockedWeek = await getNextUnlockedWeek();
    
    // Get user's fantasy teams
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have any fantasy teams.');
      return res.redirect('/teams');
    }

    // Use first team or specified team
    const teamId = req.query.team || userTeams[0].team_id;
    const selectedTeam = userTeams.find(t => t.team_id == teamId) || userTeams[0];

    // Redirect to next unlocked week with default game type
    res.redirect(`/lineups/week/${nextUnlockedWeek}/primary?team=${selectedTeam.team_id}`);
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

    // Get head coach's NFL team information
    if (selectedTeam.head_coach) {
      const coachTeamRows = await db.query(
        'SELECT team_name FROM nfl_teams WHERE head_coach = ?',
        [selectedTeam.head_coach]
      );
      if (coachTeamRows.length > 0) {
        selectedTeam.head_coach_team = coachTeamRows[0].team_name;
      }
    }

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

    // Get NFL teams for head coach selection
    const nflTeams = await NFLTeam.getAll();

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
      hasBonusGames,
      nflTeams
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

    // Save to historical_lineups for historical preservation
    await saveToHistoricalLineups(lineup.lineup_id, req.body.season_year || 2025);

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
 * Save head coach selection for lineup (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveHeadCoach = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const userId = req.session.user.id;
    const { lineup_id, head_coach } = req.body;

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

    // Check if lineup is locked
    const lockStatus = await LineupLock.getLockStatus(
      lineup[0].week_number,
      lineup[0].game_type,
      lineup[0].season_year
    );

    const isLocked = lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked';
    if (isLocked) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify lineup - it is currently locked'
      });
    }

    // Update head coach
    const success = await LineupSubmission.updateLineup(lineup_id, {
      head_coach: head_coach || null
    });

    if (success) {
      res.json({
        success: true,
        message: 'Head coach updated successfully',
        head_coach: head_coach
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to update head coach'
      });
    }

  } catch (error) {
    console.error('Error saving head coach:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving head coach: ' + error.message
    });
  }
};

/**
 * Save lineup to historical_lineups table for preservation
 * @param {number} lineupId - The lineup ID
 * @param {number} seasonYear - The season year
 */
async function saveToHistoricalLineups(lineupId, seasonYear) {
  try {
    // First, delete any existing historical entries for this lineup
    await db.query(`
      DELETE FROM historical_lineups
      WHERE season_year = ? AND lineup_id = ?
    `, [seasonYear, lineupId]);

    // Insert current lineup state into historical_lineups
    await db.query(`
      INSERT INTO historical_lineups
        (season_year, week_number, game_type, fantasy_team_id, team_name_at_time,
         owner_name_at_time, player_id, espn_id, player_name_at_time, position,
         lineup_position, acquisition_type, was_keeper, submitted_at, is_locked, lineup_id)
      SELECT
        ls.season_year,
        ls.week_number,
        ls.game_type,
        ls.fantasy_team_id,
        ft.team_name as team_name_at_time,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name_at_time,
        lp.player_id,
        np.espn_id,
        np.display_name as player_name_at_time,
        np.position,
        CONCAT(lp.position_type, lp.sort_order) as lineup_position,
        COALESCE(ftp.acquisition_type, 'Unknown') as acquisition_type,
        COALESCE(ftp.is_keeper, 0) as was_keeper,
        ls.submitted_at,
        COALESCE(ll.is_locked, 0) as is_locked,
        ls.lineup_id
      FROM lineup_submissions ls
      JOIN lineup_positions lp ON ls.lineup_id = lp.lineup_id
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      JOIN nfl_players np ON lp.player_id = np.player_id
      LEFT JOIN fantasy_team_players ftp ON lp.player_id = ftp.player_id
        AND ls.fantasy_team_id = ftp.fantasy_team_id
      LEFT JOIN lineup_locks ll ON ls.week_number = ll.week_number
        AND ls.game_type = ll.game_type
        AND ls.season_year = ll.season_year
      WHERE ls.lineup_id = ?
    `, [lineupId]);

    console.log(`Saved lineup ${lineupId} to historical_lineups`);
  } catch (error) {
    console.error(`Error saving lineup ${lineupId} to historical_lineups:`, error);
    // Don't throw - we don't want to break the lineup save if historical save fails
  }
}

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

/**
 * Helper function to get the next unlocked week for lineup editing
 * @param {number} seasonYear - The season year (default: 2025)
 * @returns {Promise<number>} Next unlocked week number
 */
async function getNextUnlockedWeek(seasonYear = 2025) {
  try {
    // Start with current week
    const currentWeek = getCurrentWeek();
    
    // Check weeks starting from current week
    for (let week = currentWeek; week <= 17; week++) {
      const isLocked = await LineupLock.isWeekLocked(week, seasonYear);
      if (!isLocked) {
        return week;
      }
    }
    
    // If all weeks are locked, return week 17 (or could return an error)
    return 17;
  } catch (error) {
    console.error('Error getting next unlocked week:', error);
    // Fallback to current week
    return getCurrentWeek();
  }
}

/**
 * Get historical lineup data organized by position
 * @param {number} lineupId - The lineup ID to fetch
 * @param {number} seasonYear - The season year
 * @returns {Promise<Object>} Roster organized by position type
 */
async function getHistoricalLineupByPosition(lineupId, seasonYear) {
  try {
    // First, get the week and team info from the lineup_id
    const lineupInfo = await db.query(`
      SELECT week_number, game_type, fantasy_team_id
      FROM lineup_submissions
      WHERE lineup_id = ?
    `, [lineupId]);

    if (!lineupInfo || lineupInfo.length === 0) {
      return null;
    }

    const { week_number, game_type, fantasy_team_id } = lineupInfo[0];

    // Fetch historical lineup data using week, game_type, and team_id
    const historicalData = await db.query(`
      SELECT
        hl.player_id,
        hl.player_name_at_time as display_name,
        hl.position,
        hl.lineup_position,
        hl.acquisition_type,
        hl.was_keeper as is_keeper,
        hl.espn_id
      FROM historical_lineups hl
      WHERE hl.season_year = ? AND hl.week_number = ? AND hl.game_type = ? AND hl.fantasy_team_id = ?
      ORDER BY hl.lineup_position
    `, [seasonYear, week_number, game_type, fantasy_team_id]);

    if (!historicalData || historicalData.length === 0) {
      return null;
    }

    // Organize by position type (matching the format expected by the view)
    const organized = {
      quarterback: { starters: [], backups: [] },
      running_back: { starters: [], backups: [] },
      receiver: { starters: [], backups: [] },
      place_kicker: { starters: [], backups: [] },
      defense: { starters: [], backups: [] }
    };

    // Position requirements
    const requirements = {
      QB: { position: 'quarterback', starters: 2 },
      RB: { position: 'running_back', starters: 3 },
      RC: { position: 'receiver', starters: 3 },
      PK: { position: 'place_kicker', starters: 1 },
      DU: { position: 'defense', starters: 1 }
    };

    // Map position codes and organize into starters/backups
    historicalData.forEach(player => {
      const posConfig = requirements[player.position];
      if (posConfig) {
        const positionGroup = organized[posConfig.position];
        if (positionGroup.starters.length < posConfig.starters) {
          positionGroup.starters.push(player);
        } else {
          positionGroup.backups.push(player);
        }
      }
    });

    return organized;
  } catch (error) {
    console.error('Error fetching historical lineup:', error);
    return null;
  }
}

module.exports = exports;