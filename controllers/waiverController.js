/**
 * Waiver Controller
 * Handles waiver wire request functionality
 */

const { validationResult } = require('express-validator');
const db = require('../config/database');
const NotificationTriggers = require('../models/NotificationTriggers');

// Helper function to get current week
async function getCurrentWeek(season) {
  try {
    const sql = 'SELECT MAX(week_number) as current_week FROM lineup_submissions WHERE season_year = ?';
    const result = await db.query(sql, [season]);
    return result && result.length > 0 ? result[0].current_week || 1 : 1;
  } catch (error) {
    console.error('Error getting current week:', error);
    return 1;
  }
}

/**
 * Submit a waiver wire request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.submitWaiverRequest = async (req, res) => {
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

    const { pickup_player_id, drop_player_id, waiver_round } = req.body;
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id, team_name
      FROM fantasy_teams
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);

    if (!userTeams || userTeams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You do not have a fantasy team'
      });
    }

    const fantasy_team_id = userTeams[0].team_id;

    // Check if pickup player is available
    const playerAvailabilityQuery = `
      SELECT p.display_name, p.position, nt.team_code,
             ftp.fantasy_team_id IS NOT NULL as is_rostered
      FROM nfl_players p
      LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
      LEFT JOIN fantasy_team_players ftp ON p.player_id = ftp.player_id
      WHERE p.player_id = ?
    `;
    const pickupPlayers = await db.query(playerAvailabilityQuery, [pickup_player_id]);

    if (pickupPlayers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Pickup player not found'
      });
    }

    if (pickupPlayers[0].is_rostered) {
      return res.status(400).json({
        success: false,
        message: 'Player is already on a team'
      });
    }

    // Handle "no drop" scenario (when drop_player_id is null/undefined)
    let dropPlayers = [];
    const isNoDrop = !drop_player_id;

    if (isNoDrop) {
      // Validate that team has available roster spots
      const rosterCountQuery = `
        SELECT COUNT(*) as current_roster_count
        FROM fantasy_team_players
        WHERE fantasy_team_id = ?
      `;
      const rosterResult = await db.query(rosterCountQuery, [fantasy_team_id]);
      const currentRosterCount = rosterResult[0].current_roster_count || 0;

      const pendingNoDropQuery = `
        SELECT COUNT(*) as pending_no_drop_count
        FROM waiver_requests
        WHERE fantasy_team_id = ?
          AND status = 'pending'
          AND drop_player_id IS NULL
      `;
      const pendingResult = await db.query(pendingNoDropQuery, [fantasy_team_id]);
      const pendingNoDropCount = pendingResult[0].pending_no_drop_count || 0;

      const maxRosterSize = 21;
      const availableSpots = maxRosterSize - currentRosterCount - pendingNoDropCount;

      if (availableSpots <= 0) {
        return res.status(400).json({
          success: false,
          message: 'No available roster spots. You must drop a player to add a new one.',
          currentRosterCount,
          pendingNoDropCount,
          maxRosterSize
        });
      }
    } else {
      // Check if drop player is on user's team
      const dropPlayerQuery = `
        SELECT p.display_name, p.position
        FROM nfl_players p
        JOIN fantasy_team_players ftp ON p.player_id = ftp.player_id
        WHERE p.player_id = ? AND ftp.fantasy_team_id = ?
      `;
      dropPlayers = await db.query(dropPlayerQuery, [drop_player_id, fantasy_team_id]);

      if (dropPlayers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Drop player not found on your team'
        });
      }
    }

    // Allow multiple requests for the same player - conflicts will be resolved when approved

    // Get the next request order for this team and round
    const orderQuery = `
      SELECT COALESCE(MAX(request_order), 0) + 1 as next_order
      FROM waiver_requests
      WHERE fantasy_team_id = ? AND status = 'pending' AND waiver_round = ?
    `;
    const orderResult = await db.query(orderQuery, [fantasy_team_id, waiver_round]);
    const request_order = orderResult[0].next_order;

    // Insert waiver request - handle NULL drop_player_id properly
    let insertQuery, insertParams;

    if (isNoDrop) {
      // For no-drop requests, explicitly set drop_player_id to NULL
      insertQuery = `
        INSERT INTO waiver_requests (
          fantasy_team_id,
          pickup_player_id,
          drop_player_id,
          request_order,
          waiver_round,
          status
        ) VALUES (?, ?, NULL, ?, ?, 'pending')
      `;
      insertParams = [
        fantasy_team_id,
        pickup_player_id,
        request_order,
        waiver_round
      ];
    } else {
      // For regular drop requests
      insertQuery = `
        INSERT INTO waiver_requests (
          fantasy_team_id,
          pickup_player_id,
          drop_player_id,
          request_order,
          waiver_round,
          status
        ) VALUES (?, ?, ?, ?, ?, 'pending')
      `;
      insertParams = [
        fantasy_team_id,
        pickup_player_id,
        drop_player_id,
        request_order,
        waiver_round
      ];
    }

    const result = await db.query(insertQuery, insertParams);

    // Auto-add pending player to current week's lineup (at bottom of their position)
    try {
      // Get current week
      const currentWeek = await getCurrentWeek(2025);
      
      // Get player's position type for lineup
      const playerPosition = pickupPlayers[0].position;
      const dropPlayerPosition = dropPlayers.length > 0 ? dropPlayers[0].position : 'N/A';
      let positionType = 'other';
      switch(playerPosition) {
        case 'QB': positionType = 'quarterback'; break;
        case 'RB': positionType = 'running_back'; break;
        case 'RC': positionType = 'receiver'; break;
        case 'PK': positionType = 'place_kicker'; break;
        case 'DU': positionType = 'defense'; break;
      }

      const dropInfo = dropPlayers.length > 0 ? `Drop ${dropPlayers[0].display_name} (${dropPlayerPosition})` : 'No drop (roster fill)';
      console.log(`Waiver request: Pickup ${pickupPlayers[0].display_name} (${playerPosition} -> ${positionType}), ${dropInfo}`);
      
      // Get or create lineup submission for current week
      const lineupQuery = `
        SELECT lineup_id FROM lineup_submissions 
        WHERE fantasy_team_id = ? AND week_number = ? AND game_type = 'primary' AND season_year = 2025
      `;
      const lineupResults = await db.query(lineupQuery, [fantasy_team_id, currentWeek]);
      
      let lineupId;
      if (lineupResults.length === 0) {
        // Create new lineup submission
        const createLineupQuery = `
          INSERT INTO lineup_submissions (fantasy_team_id, week_number, game_type, season_year)
          VALUES (?, ?, 'primary', 2025)
        `;
        const createResult = await db.query(createLineupQuery, [fantasy_team_id, currentWeek]);
        lineupId = createResult.insertId;
      } else {
        lineupId = lineupResults[0].lineup_id;
      }
      
      // Check if player is already pending in this lineup
      const existingPendingQuery = `
        SELECT position_id, waiver_request_id FROM lineup_positions 
        WHERE lineup_id = ? AND player_id = ? AND player_status = 'pending_waiver'
      `;
      const existingPending = await db.query(existingPendingQuery, [lineupId, pickup_player_id]);
      
      console.log(`Checking for existing pending player ${pickup_player_id} in lineup ${lineupId}: found ${existingPending.length} entries`);
      if (existingPending.length > 0) {
        console.log(`Player ${pickup_player_id} already pending with waiver_request_ids:`, existingPending.map(p => p.waiver_request_id));
      }
      
      // Only add if not already pending
      if (existingPending.length === 0) {
        console.log(`Adding player ${pickup_player_id} to lineup ${lineupId} with waiver_request_id ${result.insertId}`);
        // Get next sort order for this position (add to bottom)
        const sortOrderQuery = `
          SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort_order
          FROM lineup_positions 
          WHERE lineup_id = ? AND position_type = ?
        `;
        const sortResults = await db.query(sortOrderQuery, [lineupId, positionType]);
        const nextSortOrder = sortResults[0].next_sort_order;
        
        // Add pending player to lineup at bottom of their position
        const addToLineupQuery = `
          INSERT INTO lineup_positions (lineup_id, position_type, player_id, sort_order, player_status, waiver_request_id)
          VALUES (?, ?, ?, ?, 'pending_waiver', ?)
        `;
        await db.query(addToLineupQuery, [lineupId, positionType, pickup_player_id, nextSortOrder, result.insertId]);
        console.log(`Successfully added player ${pickup_player_id} to lineup ${lineupId} at position ${positionType} with sort_order ${nextSortOrder}`);
      } else {
        console.log(`Skipped adding player ${pickup_player_id} - already pending in lineup ${lineupId}`);
      }
      
    } catch (lineupError) {
      console.warn('Warning: Could not add pending player to lineup:', lineupError.message);
    }

    // Log the activity (optional - don't fail if logging fails)
    try {
      const activityQuery = `
        INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
        VALUES (?, 'waiver_request', 'player', ?, ?)
      `;
      const activityDetails = JSON.stringify({
        pickup_player: pickupPlayers[0].display_name,
        drop_player: dropPlayers.length > 0 ? dropPlayers[0].display_name : 'No drop (roster fill)',
        request_id: result.insertId,
        is_no_drop: isNoDrop
      });

      await db.query(activityQuery, [user_id, pickup_player_id, activityDetails]);
    } catch (logError) {
      console.warn('Warning: Could not log waiver request activity:', logError.message);
    }

    const successMessage = isNoDrop
      ? `Waiver request submitted: Pick up ${pickupPlayers[0].display_name} (no drop - filling roster spot)`
      : `Waiver request submitted: Pick up ${pickupPlayers[0].display_name}, drop ${dropPlayers[0].display_name}`;

    res.json({
      success: true,
      message: successMessage,
      request_id: result.insertId
    });

  } catch (error) {
    console.error('Error submitting waiver request:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error submitting waiver request',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get user's pending waiver requests
 * @param {Object} req - Express request object  
 * @param {Object} res - Express response object
 */
exports.getPendingRequests = async (req, res) => {
  try {
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id, team_name 
      FROM fantasy_teams 
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);
    
    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have a fantasy team');
      return res.redirect('/teams');
    }

    const fantasy_team_id = userTeams[0].team_id;

    // Get pending requests with player details
    const requestsQuery = `
      SELECT
        wr.request_id,
        wr.request_order,
        wr.waiver_round,
        wr.submitted_at,
        pickup.display_name as pickup_name,
        pickup.position as pickup_position,
        pickup_team.team_code as pickup_team,
        COALESCE(drop_player.display_name, '--') as drop_name,
        drop_player.position as drop_position,
        drop_team.team_code as drop_team
      FROM waiver_requests wr
      JOIN nfl_players pickup ON wr.pickup_player_id = pickup.player_id
      LEFT JOIN nfl_teams pickup_team ON pickup.nfl_team_id = pickup_team.nfl_team_id
      LEFT JOIN nfl_players drop_player ON wr.drop_player_id = drop_player.player_id
      LEFT JOIN nfl_teams drop_team ON drop_player.nfl_team_id = drop_team.nfl_team_id
      WHERE wr.fantasy_team_id = ? AND wr.status = 'pending'
      ORDER BY wr.waiver_round ASC, wr.request_order ASC
    `;
    
    const requests = await db.query(requestsQuery, [fantasy_team_id]);

    res.render('waivers/pending', {
      title: 'Pending Waiver Requests',
      team: userTeams[0],
      requests,
      activePage: 'waivers',
      user: req.session.user
    });

  } catch (error) {
    console.error('Error getting pending requests:', error);
    req.flash('error_msg', 'Error loading waiver requests');
    res.redirect('/teams');
  }
};

/**
 * Update waiver request order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateRequestOrder = async (req, res) => {
  try {
    const { request_orders } = req.body;
    const user_id = req.session.user.id;

    if (!Array.isArray(request_orders)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request order data'
      });
    }

    // Get user's team
    const userTeamQuery = `
      SELECT team_id 
      FROM fantasy_teams 
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);
    
    if (userTeams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You do not have a fantasy team'
      });
    }

    const fantasy_team_id = userTeams[0].team_id;

    // Update each request's order
    for (const item of request_orders) {
      const updateQuery = `
        UPDATE waiver_requests 
        SET request_order = ? 
        WHERE request_id = ? AND fantasy_team_id = ? AND status = 'pending'
      `;
      await db.query(updateQuery, [item.order, item.request_id, fantasy_team_id]);
    }

    res.json({
      success: true,
      message: 'Request order updated successfully'
    });

  } catch (error) {
    console.error('Error updating request order:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating request order'
    });
  }
};

/**
 * Cancel a waiver request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
/**
 * Admin view - Get all pending waiver requests across all teams
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAdminPendingRequests = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.session.user.isAdmin) {
      req.flash('error_msg', 'Admin access required');
      return res.redirect('/dashboard');
    }

    // Get all pending requests with team and player details
    const requestsQuery = `
      SELECT
        wr.request_id,
        wr.request_order,
        wr.waiver_round,
        wr.submitted_at,
        ft.team_name,
        ft.team_id as fantasy_team_id,
        u.first_name,
        u.last_name,
        pickup.display_name as pickup_name,
        pickup.position as pickup_position,
        pickup_team.team_code as pickup_team,
        COALESCE(drop_player.display_name, '--') as drop_name,
        drop_player.position as drop_position,
        drop_team.team_code as drop_team
      FROM waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      JOIN nfl_players pickup ON wr.pickup_player_id = pickup.player_id
      LEFT JOIN nfl_teams pickup_team ON pickup.nfl_team_id = pickup_team.nfl_team_id
      LEFT JOIN nfl_players drop_player ON wr.drop_player_id = drop_player.player_id
      LEFT JOIN nfl_teams drop_team ON drop_player.nfl_team_id = drop_team.nfl_team_id
      WHERE wr.status = 'pending'
      ORDER BY wr.waiver_round ASC, ft.team_name ASC, wr.request_order ASC
    `;
    
    const requests = await db.query(requestsQuery);

    res.render('waivers/admin', {
      title: 'Admin - Waiver Requests',
      requests,
      activePage: 'admin-waivers',
      user: req.session.user
    });

  } catch (error) {
    console.error('Error getting admin pending requests:', error);
    req.flash('error_msg', 'Error loading waiver requests');
    res.redirect('/dashboard');
  }
};

/**
 * Admin approve waiver request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.approveRequest = async (req, res) => {
  try {
    const request_id = req.params.id;
    const admin_user_id = req.session.user.id;

    // Check if user is admin
    if (!req.session.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Get request details
    const requestQuery = `
      SELECT wr.*, ft.team_name
      FROM waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      WHERE wr.request_id = ? AND wr.status = 'pending'
    `;
    const requestResults = await db.query(requestQuery, [request_id]);

    if (requestResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or already processed'
      });
    }

    const request = requestResults[0];

    // Calculate current week if not set - BEFORE processing rejections
    let weekString = request.week;
    const currentSeason = new Date().getFullYear();

    if (!weekString) {
      const WeekStatus = require('../models/WeekStatus');

      // Use the same week logic as lineup submissions for consistency
      const currentWeekNumber = await WeekStatus.getCurrentWeek(currentSeason);
      weekString = `Week ${currentWeekNumber}`;

      // Update ALL pending requests for this pickup player with the week BEFORE rejecting them
      const updateAllWeeksQuery = `
        UPDATE waiver_requests
        SET week = ?
        WHERE pickup_player_id = ? AND status = 'pending' AND week IS NULL
      `;
      await db.query(updateAllWeeksQuery, [weekString, request.pickup_player_id]);

      console.log(`Updated week to ${weekString} for all pending requests for player ${request.pickup_player_id}`);
    }

    // Set waiver_order_position for ALL pending requests BEFORE auto-rejection
    // This ensures rejected requests also get their position recorded
    try {
      const updateAllWaiverOrdersQuery = `
        UPDATE waiver_requests wr
        JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
        JOIN league_standings ls ON ft.team_id = ls.fantasy_team_id
        SET wr.waiver_order_position = (11 - ls.position)
        WHERE wr.pickup_player_id = ?
          AND wr.status = 'pending'
          AND ls.season_year = ?
          AND wr.waiver_order_position IS NULL
      `;
      await db.query(updateAllWaiverOrdersQuery, [request.pickup_player_id, currentSeason]);
      console.log(`Set waiver_order_position for all pending requests for player ${request.pickup_player_id}`);

      // Re-fetch the request to get the updated waiver_order_position
      const updatedRequestQuery = `
        SELECT wr.*, ft.team_name
        FROM waiver_requests wr
        JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
        WHERE wr.request_id = ?
      `;
      const updatedRequestResult = await db.query(updatedRequestQuery, [request_id]);
      if (updatedRequestResult.length > 0) {
        Object.assign(request, updatedRequestResult[0]);
        console.log(`Updated request object with waiver_order_position: ${request.waiver_order_position}`);
      }
    } catch (orderError) {
      console.error('Error setting waiver order positions:', orderError);
      // Don't fail the approval, but log the error
    }

    // Check if pickup player is still available
    const availabilityCheckQuery = `
      SELECT COUNT(*) as roster_count
      FROM fantasy_team_players
      WHERE player_id = ?
    `;
    const availabilityResult = await db.query(availabilityCheckQuery, [request.pickup_player_id]);

    if (availabilityResult[0].roster_count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Player is no longer available - already on another team'
      });
    }

    // Update week and waiver_order_position for ALL pending requests involving the drop player BEFORE rejecting them
    const updateDropPlayerDataQuery = `
      UPDATE waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      JOIN league_standings ls ON ft.team_id = ls.fantasy_team_id AND ls.season_year = ?
      SET wr.week = ?,
          wr.waiver_order_position = (11 - ls.position)
      WHERE (wr.pickup_player_id = ? OR wr.drop_player_id = ?)
        AND wr.status = 'pending'
        AND wr.request_id != ?
        AND (wr.week IS NULL OR wr.waiver_order_position IS NULL)
    `;
    await db.query(updateDropPlayerDataQuery, [currentSeason, weekString, request.drop_player_id, request.drop_player_id, request_id]);
    console.log(`Updated week and waiver position for all pending requests involving drop player ${request.drop_player_id}`);

    // Auto-reject ALL conflicting requests for the same pickup player (from ALL teams)
    const conflictingPickupRequestsQuery = `
      UPDATE waiver_requests
      SET status = 'rejected', processed_at = NOW(), processed_by = ?, notes = 'Auto-rejected: Player acquired by another team'
      WHERE pickup_player_id = ? AND status = 'pending' AND request_id != ?
    `;
    const pickupRejectResult = await db.query(conflictingPickupRequestsQuery, [admin_user_id, request.pickup_player_id, request_id]);

    // Auto-reject ALL conflicting requests involving the dropped player (pickup or drop, from ALL teams)
    const conflictingDropRequestsQuery = `
      UPDATE waiver_requests
      SET status = 'rejected', processed_at = NOW(), processed_by = ?, notes = 'Auto-rejected: Player no longer available for trade'
      WHERE (pickup_player_id = ? OR drop_player_id = ?) AND status = 'pending' AND request_id != ?
    `;
    const dropRejectResult = await db.query(conflictingDropRequestsQuery, [admin_user_id, request.drop_player_id, request.drop_player_id, request_id]);

    // Remove lineup positions for rejected conflicting requests
    try {
      const removeConflictingLineupsQuery = `
        DELETE FROM lineup_positions
        WHERE waiver_request_id IN (
          SELECT request_id FROM waiver_requests
          WHERE status = 'rejected' AND processed_by = ? AND processed_at >= NOW() - INTERVAL 1 MINUTE
        )
      `;
      await db.query(removeConflictingLineupsQuery, [admin_user_id]);
    } catch (lineupCleanupError) {
      console.warn('Warning: Could not clean up conflicting lineup positions:', lineupCleanupError.message);
    }

    // Execute the waiver: remove drop player (if exists), add pickup player
    // Remove drop player from team (only if this is not a no-drop request)
    if (request.drop_player_id) {
      const removePlayerQuery = `
        DELETE FROM fantasy_team_players
        WHERE fantasy_team_id = ? AND player_id = ?
      `;
      await db.query(removePlayerQuery, [request.fantasy_team_id, request.drop_player_id]);
    }

    // Add pickup player to team
    const addPlayerQuery = `
      INSERT INTO fantasy_team_players (fantasy_team_id, player_id, acquisition_type)
      VALUES (?, ?, 'Free Agent')
    `;
    await db.query(addPlayerQuery, [request.fantasy_team_id, request.pickup_player_id]);

    // Update request status
    const updateRequestQuery = `
      UPDATE waiver_requests 
      SET status = 'approved', processed_at = NOW(), processed_by = ?
      WHERE request_id = ?
    `;
    await db.query(updateRequestQuery, [admin_user_id, request_id]);

    // Update lineup positions: swap dropped player with pickup player
    try {
      const weekNumber = parseInt(weekString.replace(/\D/g, ''));

      // Get the pickup player's position type
      const pickupPlayerQuery = `
        SELECT position,
          CASE
            WHEN position = 'QB' THEN 'quarterback'
            WHEN position = 'RB' THEN 'running_back'
            WHEN position = 'RC' THEN 'receiver'
            WHEN position = 'PK' THEN 'place_kicker'
            WHEN position = 'DU' THEN 'defense'
            ELSE 'other'
          END as position_type
        FROM nfl_players WHERE player_id = ?
      `;
      const pickupPlayerResult = await db.query(pickupPlayerQuery, [request.pickup_player_id]);
      const pickupPositionType = pickupPlayerResult.length > 0 ? pickupPlayerResult[0].position_type : null;

      // First, convert any pending_waiver entries for this request to rostered
      const updateLineupQuery = `
        UPDATE lineup_positions
        SET player_status = 'rostered', waiver_request_id = NULL
        WHERE waiver_request_id = ? AND player_status = 'pending_waiver'
      `;
      await db.query(updateLineupQuery, [request_id]);

      // Get all lineup_positions entries for the dropped player in current and future weeks
      const getDroppedPositionsQuery = `
        SELECT lp.position_id, lp.lineup_id, lp.position_type, lp.sort_order, ls.week_number
        FROM lineup_positions lp
        JOIN lineup_submissions ls ON lp.lineup_id = ls.lineup_id
        WHERE lp.player_id = ?
          AND ls.fantasy_team_id = ?
          AND ls.week_number >= ?
          AND ls.season_year = ?
      `;
      const droppedPositions = await db.query(getDroppedPositionsQuery, [
        request.drop_player_id, request.fantasy_team_id, weekNumber, currentSeason
      ]);

      // For each dropped player position, replace with pickup player (if same position type and not already in lineup)
      for (const pos of droppedPositions) {
        // Check if pickup player is already in this lineup
        const existsQuery = `
          SELECT position_id FROM lineup_positions
          WHERE lineup_id = ? AND player_id = ?
        `;
        const existsResult = await db.query(existsQuery, [pos.lineup_id, request.pickup_player_id]);

        if (existsResult.length === 0 && pickupPositionType === pos.position_type) {
          // Replace dropped player with pickup player (same sort_order to maintain position)
          const replaceQuery = `
            UPDATE lineup_positions
            SET player_id = ?, player_status = NULL, waiver_request_id = NULL
            WHERE position_id = ?
          `;
          await db.query(replaceQuery, [request.pickup_player_id, pos.position_id]);
          console.log(`Replaced player ${request.drop_player_id} with ${request.pickup_player_id} in lineup ${pos.lineup_id} (week ${pos.week_number})`);
        } else {
          // Different position type or pickup already exists - just remove the dropped player
          const deleteQuery = `DELETE FROM lineup_positions WHERE position_id = ?`;
          await db.query(deleteQuery, [pos.position_id]);
          console.log(`Removed dropped player ${request.drop_player_id} from lineup ${pos.lineup_id} (week ${pos.week_number})`);

          // If pickup player not in lineup and same position type, add at end
          if (existsResult.length === 0 && pickupPositionType) {
            const maxSortQuery = `
              SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort
              FROM lineup_positions WHERE lineup_id = ? AND position_type = ?
            `;
            const sortResult = await db.query(maxSortQuery, [pos.lineup_id, pickupPositionType]);
            const nextSort = sortResult[0].next_sort;

            const insertQuery = `
              INSERT INTO lineup_positions (lineup_id, position_type, player_id, sort_order, created_at)
              VALUES (?, ?, ?, ?, NOW())
            `;
            await db.query(insertQuery, [pos.lineup_id, pickupPositionType, request.pickup_player_id, nextSort]);
            console.log(`Added pickup player ${request.pickup_player_id} to lineup ${pos.lineup_id} (week ${pos.week_number})`);
          }
        }
      }

      // If dropped player wasn't in any lineups but pickup player needs to be added to current week
      if (droppedPositions.length === 0 && pickupPositionType) {
        // Get all lineups for this team for current and future weeks
        const lineupsQuery = `
          SELECT lineup_id, week_number FROM lineup_submissions
          WHERE fantasy_team_id = ? AND week_number >= ? AND season_year = ?
        `;
        const lineups = await db.query(lineupsQuery, [request.fantasy_team_id, weekNumber, currentSeason]);

        for (const lineup of lineups) {
          // Check if pickup player already in this lineup
          const existsQuery = `
            SELECT position_id FROM lineup_positions
            WHERE lineup_id = ? AND player_id = ?
          `;
          const existsResult = await db.query(existsQuery, [lineup.lineup_id, request.pickup_player_id]);

          if (existsResult.length === 0) {
            const maxSortQuery = `
              SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort
              FROM lineup_positions WHERE lineup_id = ? AND position_type = ?
            `;
            const sortResult = await db.query(maxSortQuery, [lineup.lineup_id, pickupPositionType]);
            const nextSort = sortResult[0].next_sort;

            const insertQuery = `
              INSERT INTO lineup_positions (lineup_id, position_type, player_id, sort_order, created_at)
              VALUES (?, ?, ?, ?, NOW())
            `;
            await db.query(insertQuery, [lineup.lineup_id, pickupPositionType, request.pickup_player_id, nextSort]);
            console.log(`Added pickup player ${request.pickup_player_id} to lineup ${lineup.lineup_id} (week ${lineup.week_number})`);
          }
        }
      }
    } catch (lineupError) {
      console.warn('Warning: Could not update lineup positions:', lineupError.message);
      console.warn('Lineup error stack:', lineupError.stack);
    }

    // NOTE: waiver_order_position was already set earlier (before auto-rejection)
    // This ensures both approved and rejected requests have proper position values

    // Record in unified transactions table
    try {
      // Get player names for the transaction (LEFT JOIN for drop_player to handle no-drop waivers)
      const playerQuery = `
        SELECT
          p1.display_name as pickup_name,
          p2.display_name as drop_name
        FROM nfl_players p1
        LEFT JOIN nfl_players p2 ON p2.player_id = ?
        WHERE p1.player_id = ?
      `;
      const playerResult = await db.query(playerQuery, [request.drop_player_id, request.pickup_player_id]);

      if (playerResult.length > 0) {
        const { pickup_name, drop_name } = playerResult[0];
        await recordWaiverTransaction(request, admin_user_id, pickup_name, drop_name || null);
        console.log(`Successfully recorded waiver transaction for request ${request_id}`);
      }
    } catch (transactionError) {
      console.error('ERROR: Could not record waiver transaction:', transactionError.message);
      console.error('Transaction error stack:', transactionError.stack);
    }

    // Log the activity
    try {
      const activityQuery = `
        INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
        VALUES (?, 'waiver_approved', 'waiver_request', ?, ?)
      `;
      const activityDetails = JSON.stringify({
        request_id: request_id,
        team_name: request.team_name,
        approved_by: admin_user_id
      });

      await db.query(activityQuery, [admin_user_id, request_id, activityDetails]);
    } catch (logError) {
      console.warn('Warning: Could not log waiver approval activity:', logError.message);
    }

    // Send notification to the user
    try {
      // Get player names for the notification (LEFT JOIN for drop_player to handle no-drop waivers)
      const playerQuery = `
        SELECT
          p1.display_name as pickup_name,
          p2.display_name as drop_name
        FROM nfl_players p1
        LEFT JOIN nfl_players p2 ON p2.player_id = ?
        WHERE p1.player_id = ?
      `;
      const playerResult = await db.query(playerQuery, [request.drop_player_id, request.pickup_player_id]);

      if (playerResult.length > 0) {
        const { pickup_name, drop_name } = playerResult[0];
        await NotificationTriggers.notifyWaiverProcessed(
          request_id,
          request.fantasy_team_id,
          pickup_name,
          'approved'
        );
      }
    } catch (notifyError) {
      console.warn('Warning: Could not send waiver approval notification:', notifyError.message);
    }

    res.json({
      success: true,
      message: 'Waiver request approved successfully',
      rejectedRequests: {
        pickup: pickupRejectResult.affectedRows,
        drop: dropRejectResult.affectedRows,
        pickupPlayerId: request.pickup_player_id,
        dropPlayerId: request.drop_player_id
      }
    });

  } catch (error) {
    console.error('Error approving waiver request:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving waiver request'
    });
  }
};

/**
 * Admin reject waiver request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.rejectRequest = async (req, res) => {
  try {
    const request_id = req.params.id;
    const admin_user_id = req.session.user.id;
    const { notes } = req.body;

    // Check if user is admin
    if (!req.session.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Get request details before updating
    const requestQuery = `
      SELECT wr.*, ft.team_id as fantasy_team_id
      FROM waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      WHERE wr.request_id = ? AND wr.status = 'pending'
    `;
    const requestResults = await db.query(requestQuery, [request_id]);

    if (requestResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or already processed'
      });
    }

    const request = requestResults[0];

    // Update request status
    const updateRequestQuery = `
      UPDATE waiver_requests
      SET status = 'rejected', processed_at = NOW(), processed_by = ?, notes = ?
      WHERE request_id = ? AND status = 'pending'
    `;
    const result = await db.query(updateRequestQuery, [admin_user_id, notes || null, request_id]);

    // Remove pending_waiver entry from lineup_positions
    try {
      const removeLineupQuery = `
        DELETE FROM lineup_positions
        WHERE waiver_request_id = ? AND player_status = 'pending_waiver'
      `;
      const removeResult = await db.query(removeLineupQuery, [request_id]);
      if (removeResult.affectedRows > 0) {
        console.log(`Removed ${removeResult.affectedRows} pending_waiver lineup position(s) for rejected request ${request_id}`);
      }
    } catch (lineupError) {
      console.warn('Warning: Could not remove pending_waiver lineup position:', lineupError.message);
    }

    // Log the activity
    try {
      const activityQuery = `
        INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
        VALUES (?, 'waiver_rejected', 'waiver_request', ?, ?)
      `;
      const activityDetails = JSON.stringify({
        request_id: request_id,
        rejected_by: admin_user_id,
        notes: notes
      });
      
      await db.query(activityQuery, [admin_user_id, request_id, activityDetails]);
    } catch (logError) {
      console.warn('Warning: Could not log waiver rejection activity:', logError.message);
    }

    // Send notification to the user
    try {
      // Get player name for the notification
      const playerQuery = `SELECT display_name FROM nfl_players WHERE player_id = ?`;
      const playerResult = await db.query(playerQuery, [request.pickup_player_id]);
      
      if (playerResult.length > 0) {
        const playerName = playerResult[0].display_name;
        await NotificationTriggers.notifyWaiverProcessed(
          request_id, 
          request.fantasy_team_id, 
          playerName, 
          'rejected',
          notes
        );
      }
    } catch (notifyError) {
      console.warn('Warning: Could not send waiver rejection notification:', notifyError.message);
    }

    res.json({
      success: true,
      message: 'Waiver request rejected'
    });

  } catch (error) {
    console.error('Error rejecting waiver request:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting waiver request'
    });
  }
};

/**
 * Get pending waiver request count for current user's team
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
/**
 * Debug endpoint - Check waiver requests data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.debugWaiverData = async (req, res) => {
  try {
    // Get basic counts
    const totalQuery = `SELECT COUNT(*) as total FROM waiver_requests`;
    const pendingQuery = `SELECT COUNT(*) as pending FROM waiver_requests WHERE status = 'pending'`;
    const sampleQuery = `SELECT * FROM waiver_requests LIMIT 5`;
    
    const [totalResult, pendingResult, sampleRequests] = await Promise.all([
      db.query(totalQuery),
      db.query(pendingQuery),
      db.query(sampleQuery)
    ]);
    
    res.json({
      total_requests: totalResult[0].total,
      pending_requests: pendingResult[0].pending,
      sample_data: sampleRequests,
      user_is_admin: req.session.user.isAdmin,
      user_info: req.session.user
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getPendingRequestCount = async (req, res) => {
  try {
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id 
      FROM fantasy_teams 
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);
    
    if (userTeams.length === 0) {
      return res.json({
        success: true,
        count: 0,
        message: 'No team found'
      });
    }

    const fantasy_team_id = userTeams[0].team_id;

    // Get pending request count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM waiver_requests 
      WHERE fantasy_team_id = ? AND status = 'pending'
    `;
    const countResult = await db.query(countQuery, [fantasy_team_id]);

    res.json({
      success: true,
      count: countResult[0].count
    });

  } catch (error) {
    console.error('Error getting pending request count:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading waiver request count'
    });
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const request_id = req.params.id;
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id 
      FROM fantasy_teams 
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);
    
    if (userTeams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You do not have a fantasy team'
      });
    }

    const fantasy_team_id = userTeams[0].team_id;

    // Delete the request
    const deleteQuery = `
      DELETE FROM waiver_requests 
      WHERE request_id = ? AND fantasy_team_id = ? AND status = 'pending'
    `;
    const result = await db.query(deleteQuery, [request_id, fantasy_team_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or cannot be cancelled'
      });
    }

    // Remove pending_waiver entry from lineup_positions
    try {
      const removeLineupQuery = `
        DELETE FROM lineup_positions
        WHERE waiver_request_id = ? AND player_status = 'pending_waiver'
      `;
      const removeResult = await db.query(removeLineupQuery, [request_id]);
      if (removeResult.affectedRows > 0) {
        console.log(`Removed ${removeResult.affectedRows} pending_waiver lineup position(s) for cancelled request ${request_id}`);
      }
    } catch (lineupError) {
      console.warn('Warning: Could not remove pending_waiver lineup position:', lineupError.message);
    }

    // Log the activity (optional - don't fail if logging fails)
    try {
      const activityQuery = `
        INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
        VALUES (?, 'waiver_cancel', 'waiver_request', ?, ?)
      `;
      const activityDetails = JSON.stringify({
        request_id: request_id,
        action: 'cancelled'
      });
      
      await db.query(activityQuery, [user_id, request_id, activityDetails]);
    } catch (logError) {
      console.warn('Warning: Could not log waiver cancel activity:', logError.message);
    }

    res.json({
      success: true,
      message: 'Waiver request cancelled'
    });

  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling request'
    });
  }
};

/**
 * Record approved waiver in unified transactions table
 */
async function recordWaiverTransaction(request, admin_user_id, pickupPlayerName, dropPlayerName) {
  try {
    console.log('Recording waiver transaction with data:', {
      request_id: request.request_id,
      week: request.week,
      waiver_round: request.waiver_round,
      waiver_order_position: request.waiver_order_position,
      fantasy_team_id: request.fantasy_team_id,
      pickup_player_id: request.pickup_player_id,
      drop_player_id: request.drop_player_id
    });

    // Validate required fields
    if (!request.week) {
      throw new Error('Week is required but is NULL or undefined');
    }
    if (!request.waiver_order_position && request.waiver_order_position !== 0) {
      console.warn('Warning: waiver_order_position is NULL or undefined - transaction notes will be incomplete');
    }

    // Create transaction record with proper waiver wire format
    const transactionQuery = `
      INSERT INTO transactions (transaction_type, season_year, week, transaction_date, notes, created_by)
      VALUES ('Waiver', 2025, ?, CURDATE(), ?, ?)
    `;

    // Format notes to match standard: "Waiver wire - 1st round, position 3"
    const roundText = request.waiver_round === 1 ? '1st' : request.waiver_round === 2 ? '2nd' : `${request.waiver_round}th`;
    const positionText = request.waiver_order_position || 'unknown';
    const notes = `Waiver wire - ${roundText} round, position ${positionText}`;

    console.log(`Creating transaction with notes: "${notes}"`);

    const transactionResult = await db.query(transactionQuery, [request.week, notes, admin_user_id]);
    const transaction_id = transactionResult.insertId;

    // Add transaction relationship (only the team that made the waiver request)
    await db.query(
      'INSERT INTO transaction_relationships (transaction_id, team_id, is_primary) VALUES (?, ?, 1)',
      [transaction_id, request.fantasy_team_id]
    );

    // Add transaction items - player acquired
    await db.query(`
      INSERT INTO transaction_items (
        transaction_id, team_id, direction, item_type, player_id
      ) VALUES (?, ?, 'Acquired', 'Player', ?)
    `, [transaction_id, request.fantasy_team_id, request.pickup_player_id]);

    // Add transaction items - player lost (only if there was a drop)
    if (request.drop_player_id) {
      await db.query(`
        INSERT INTO transaction_items (
          transaction_id, team_id, direction, item_type, player_id
        ) VALUES (?, ?, 'Lost', 'Player', ?)
      `, [transaction_id, request.fantasy_team_id, request.drop_player_id]);
    }

    console.log(`Successfully recorded waiver transaction ${transaction_id} for team ${request.fantasy_team_id}: ${notes}`);
    return transaction_id;

  } catch (error) {
    console.error('Error recording waiver transaction:', error);
    console.error('Request data at time of error:', request);
    throw error;
  }
}

// Removed recordRejectedWaiverAttempts function - rejected waivers are no longer recorded
// in the transactions table to avoid clutter. Users can see rejected requests on the waivers page.

/**
 * Get all processed waiver requests (history view)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllProcessedRequests = async (req, res) => {
  try {
    const weekFilter = req.query.week || null;

    // Get all available weeks
    const weeksQuery = `
      SELECT DISTINCT week
      FROM waiver_requests
      WHERE status IN ('approved', 'rejected')
        AND week IS NOT NULL
        AND week LIKE 'Week%'
      ORDER BY CAST(REGEXP_REPLACE(week, '[^0-9]', '') AS UNSIGNED) DESC
    `;
    const weeksResult = await db.query(weeksQuery);
    const availableWeeks = Array.isArray(weeksResult[0]) ? weeksResult[0] : weeksResult;

    // Default to most recent week if no filter specified
    const selectedWeek = weekFilter || (availableWeeks.length > 0 ? availableWeeks[0].week : null);

    // Get all processed requests for the selected week
    const requestsQuery = `
      SELECT
        wr.request_id,
        wr.request_order,
        wr.waiver_round,
        wr.waiver_order_position,
        wr.status,
        wr.notes,
        wr.submitted_at,
        wr.processed_at,
        ft.team_name,
        ft.team_id as fantasy_team_id,
        u.first_name,
        u.last_name,
        pickup.display_name as pickup_name,
        pickup.position as pickup_position,
        pickup_team.team_code as pickup_team,
        COALESCE(drop_player.display_name, '--') as drop_name,
        drop_player.position as drop_position,
        drop_team.team_code as drop_team
      FROM waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      JOIN nfl_players pickup ON wr.pickup_player_id = pickup.player_id
      LEFT JOIN nfl_teams pickup_team ON pickup.nfl_team_id = pickup_team.nfl_team_id
      LEFT JOIN nfl_players drop_player ON wr.drop_player_id = drop_player.player_id
      LEFT JOIN nfl_teams drop_team ON drop_player.nfl_team_id = drop_team.nfl_team_id
      WHERE wr.status IN ('approved', 'rejected')
        AND wr.week = ?
      ORDER BY
        FIELD(wr.waiver_round, '1st', '2nd'),
        wr.waiver_order_position ASC,
        ft.team_name ASC,
        wr.request_order ASC
    `;

    const result = await db.query(requestsQuery, [selectedWeek]);
    const requests = Array.isArray(result[0]) ? result[0] : result;

    // Group requests by round, then by team
    const groupedRequests = {
      '1st': {},
      '2nd': {}
    };

    requests.forEach(request => {
      const round = request.waiver_round;
      const teamName = request.team_name;

      if (!groupedRequests[round][teamName]) {
        groupedRequests[round][teamName] = {
          team_name: teamName,
          first_name: request.first_name,
          last_name: request.last_name,
          waiver_order_position: request.waiver_order_position,
          requests: []
        };
      }

      groupedRequests[round][teamName].requests.push(request);
    });

    res.render('waivers/all-requests', {
      title: 'All Waiver Requests',
      selectedWeek,
      availableWeeks,
      groupedRequests,
      activePage: 'transactions',
      user: req.session.user
    });

  } catch (error) {
    console.error('Error getting all processed requests:', error);
    req.flash('error_msg', 'Error loading waiver requests');
    res.redirect('/transactions');
  }
};

/**
 * Check available roster spots for a team
 * Returns how many spots are available for no-drop waiver adds
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.checkAvailableRosterSpots = async (req, res) => {
  try {
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id
      FROM fantasy_teams
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);

    if (!userTeams || userTeams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You do not have a fantasy team'
      });
    }

    const fantasy_team_id = userTeams[0].team_id;

    // Get current roster count (active players only)
    const rosterCountQuery = `
      SELECT COUNT(*) as current_roster_count
      FROM fantasy_team_players
      WHERE fantasy_team_id = ?
    `;
    const rosterResult = await db.query(rosterCountQuery, [fantasy_team_id]);
    const currentRosterCount = rosterResult[0].current_roster_count || 0;

    // Get pending "no drop" waiver requests count (where drop_player_id IS NULL)
    const pendingNoDropQuery = `
      SELECT COUNT(*) as pending_no_drop_count
      FROM waiver_requests
      WHERE fantasy_team_id = ?
        AND status = 'pending'
        AND drop_player_id IS NULL
    `;
    const pendingResult = await db.query(pendingNoDropQuery, [fantasy_team_id]);
    const pendingNoDropCount = pendingResult[0].pending_no_drop_count || 0;

    // Calculate available spots: 21 - current_roster - pending_no_drops
    const maxRosterSize = 21;
    const availableSpots = maxRosterSize - currentRosterCount - pendingNoDropCount;
    const canAddWithoutDrop = availableSpots > 0;

    res.json({
      success: true,
      currentRosterCount,
      pendingNoDropCount,
      maxRosterSize,
      availableSpots: Math.max(0, availableSpots),
      canAddWithoutDrop
    });

  } catch (error) {
    console.error('Error checking available roster spots:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking roster availability',
      error: error.message
    });
  }
};