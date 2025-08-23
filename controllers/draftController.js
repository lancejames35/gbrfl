/**
 * Draft Controller
 * Handles all draft-related functionality
 */

const FantasyTeam = require('../models/FantasyTeam');
const db = require('../config/database');
const CURRENT_SEASON = new Date().getFullYear();

/**
 * Get the main draft room interface
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDraftRoom = async (req, res) => {
  try {
    const userId = req.session.user.id;
    console.log('Loading draft room for user:', userId);
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      console.log('No teams found for user:', userId);
      req.flash('error_msg', 'You must have a team to access the draft');
      return res.redirect('/teams');
    }
    
    const userTeam = userTeams[0]; // Assuming one team per user
    console.log('User team:', userTeam.team_name);
    
    // Get draft status
    const draftStatus = await this.getDraftStatus();
    console.log('Draft status:', draftStatus);
    
    // Get all teams for team viewing
    const allTeams = await FantasyTeam.getAll();
    console.log('All teams count:', allTeams.length);
    
    // Get NFL teams for filters
    const nflTeams = await db.query('SELECT * FROM nfl_teams ORDER BY team_name');
    console.log('NFL teams count:', nflTeams.length);
    
    // Get user's queue
    const queue = await this.getUserQueue(userTeam.team_id);
    console.log('User queue length:', queue.length);
    
    res.render('draft/room', {
      title: 'Draft Room',
      userTeam,
      allTeams,
      nflTeams,
      draftStatus,
      queue,
      user: req.session.user,
      originalAdmin: req.session.originalAdmin,
      activePage: 'draft',
      layout: false // Draft uses custom full-screen layout
    });
    
  } catch (error) {
    console.error('Error loading draft room:', error.message);
    req.flash('error_msg', 'Error loading draft room');
    res.redirect('/dashboard');
  }
};

/**
 * Get available players for drafting with filters
 * @param {Object} req - Express request object  
 * @param {Object} res - Express response object
 */
exports.getAvailablePlayers = async (req, res) => {
  try {
    const { position, team, search, showDrafted } = req.query;
    
    let sql = `
    SELECT p.*, nt.team_name, nt.team_code,
           ftp.fantasy_team_id IS NOT NULL as is_rostered,
           ft.team_name as fantasy_team_name,
           dp.pick_id IS NOT NULL as is_drafted
    FROM nfl_players p
    LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
    LEFT JOIN fantasy_team_players ftp ON p.player_id = ftp.player_id AND ftp.is_keeper = 0
    LEFT JOIN fantasy_teams ft ON ftp.fantasy_team_id = ft.team_id
    LEFT JOIN draft_picks dp ON p.player_id = dp.player_id AND dp.season = ?
    WHERE 1=1
    `;
    
    const params = [CURRENT_SEASON];
    
    sql += ` AND p.player_id NOT IN (
      SELECT player_id FROM fantasy_team_players WHERE is_keeper = 1
    )`;
    
    // Show/hide drafted players based on checkbox
    if (showDrafted !== 'true') {
      // When showDrafted=false: exclude drafted players AND exclude 2025 draft picks
      sql += ` AND dp.pick_id IS NULL`;
      sql += ` AND p.player_id NOT IN (
        SELECT player_id FROM fantasy_team_players WHERE is_keeper = 0
      )`;
    }
    
    // Position filter
    if (position) {
      sql += ` AND p.position = ?`;
      params.push(position);
    }
    
    // NFL Team filter
    if (team) {
      if (team === 'null') {
        sql += ` AND p.nfl_team_id IS NULL`;
      } else {
        sql += ` AND p.nfl_team_id = ?`;
        params.push(team);
      }
    }
    
    // Name search
    if (search) {
      sql += ` AND (p.display_name LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    // Order by last name
    sql += ` ORDER BY p.last_name, p.first_name LIMIT 1000`;

    const players = await db.query(sql, params);
    
    res.json({ success: true, players });
    
  } catch (error) {
    console.error('Error getting available players:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving players' });
  }
};

/**
 * Add a player to user's draft queue
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.addToQueue = async (req, res) => {
  try {
    const { playerId } = req.body;
    const userId = req.session.user.id;
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      return res.status(400).json({ success: false, message: 'No team found' });
    }
    
    const teamId = userTeams[0].team_id;
    
    // Check if player is already in queue
    const existing = await db.query(
      'SELECT * FROM draft_queue WHERE fantasy_team_id = ? AND player_id = ?',
      [teamId, playerId]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Player already in queue' });
    }
    
    // Get next queue order
    const maxOrder = await db.query(
      'SELECT MAX(queue_order) as max_order FROM draft_queue WHERE fantasy_team_id = ?',
      [teamId]
    );
    
    const nextOrder = (maxOrder[0]?.max_order || 0) + 1;
    
    // Add to queue
    await db.query(
      'INSERT INTO draft_queue (fantasy_team_id, player_id, queue_order) VALUES (?, ?, ?)',
      [teamId, playerId, nextOrder]
    );
    
    res.json({ success: true, message: 'Player added to queue' });
    
  } catch (error) {
    console.error('Error adding to queue:', error.message);
    res.status(500).json({ success: false, message: 'Error adding player to queue' });
  }
};

/**
 * Get current draft order and status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDraftOrder = async (req, res) => {
  try {
    const sql = `
      SELECT 
        do.round,
        do.pick_number,
        (do.round - 1) * 10 + do.pick_number as overall_pick,
        do.fantasy_team_id,
        do.original_team_id,
        ft.team_name,
        u.first_name,
        u.last_name,
        orig_ft.team_name as original_team_name,
        orig_u.first_name as original_first_name,
        orig_u.last_name as original_last_name,
        dp.player_id,
        p.display_name as drafted_player,
        p.position as drafted_position,
        nt.team_code as drafted_team
      FROM draft_order do
      JOIN fantasy_teams ft ON do.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      LEFT JOIN fantasy_teams orig_ft ON do.original_team_id = orig_ft.team_id
      LEFT JOIN users orig_u ON orig_ft.user_id = orig_u.user_id
      LEFT JOIN draft_picks dp ON do.round = dp.round AND do.pick_number = dp.pick_number AND dp.season = do.season
      LEFT JOIN nfl_players p ON dp.player_id = p.player_id
      LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
      WHERE do.season = ?
      ORDER BY overall_pick
    `;
    
    const draftOrder = await db.query(sql, [CURRENT_SEASON]);
    
    // Get current draft status
    const statusSql = `SELECT * FROM draft_status WHERE season = ? LIMIT 1`;
    const status = await db.query(statusSql, [CURRENT_SEASON]);
    const draftStatus = status[0] || { is_active: 0, current_round: 1, current_pick: 1 };
    
    res.json({ 
      success: true, 
      draftOrder: draftOrder,
      draftStatus: draftStatus
    });
    
  } catch (error) {
    console.error('Error getting draft order:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving draft order' });
  }
};

/**
 * Get user's current draft queue
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getQueue = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      return res.status(400).json({ success: false, message: 'No team found' });
    }
    
    const teamId = userTeams[0].team_id;
    const queue = await this.getUserQueue(teamId);
    
    res.json({ success: true, queue });
    
  } catch (error) {
    console.error('Error getting queue:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving queue' });
  }
};

/**
 * Remove a player from user's draft queue
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.removeFromQueue = async (req, res) => {
  try {
    const { playerId } = req.body;
    const userId = req.session.user.id;
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      return res.status(400).json({ success: false, message: 'No team found' });
    }
    
    const teamId = userTeams[0].team_id;
    
    // Remove from queue
    await db.query(
      'DELETE FROM draft_queue WHERE fantasy_team_id = ? AND player_id = ?',
      [teamId, playerId]
    );
    
    // Reorder remaining queue items
    await this.reorderQueueItems(teamId);
    
    res.json({ success: true, message: 'Player removed from queue' });
    
  } catch (error) {
    console.error('Error removing from queue:', error.message);
    res.status(500).json({ success: false, message: 'Error removing player from queue' });
  }
};

/**
 * Reorder user's draft queue
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.reorderQueue = async (req, res) => {
  try {
    const { playerIds } = req.body; // Array of player IDs in new order
    const userId = req.session.user.id;
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      return res.status(400).json({ success: false, message: 'No team found' });
    }
    
    const teamId = userTeams[0].team_id;
    
    // Update queue order
    for (let i = 0; i < playerIds.length; i++) {
      await db.query(
        'UPDATE draft_queue SET queue_order = ? WHERE fantasy_team_id = ? AND player_id = ?',
        [i + 1, teamId, playerIds[i]]
      );
    }
    
    res.json({ success: true, message: 'Queue reordered successfully' });
    
  } catch (error) {
    console.error('Error reordering queue:', error.message);
    res.status(500).json({ success: false, message: 'Error reordering queue' });
  }
};

/**
 * Make a draft pick
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.makePick = async (req, res) => {
  try {
    const { playerId } = req.body;
    const userId = req.session.user.id;

    if (!playerId) {
      return res.status(400).json({ success: false, message: 'Player ID is required' });
    }
    
    const playerIdNum = parseInt(playerId);
    if (isNaN(playerIdNum) || playerIdNum <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid player ID' });
    }
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    if (userTeams.length === 0) {
      return res.status(400).json({ success: false, message: 'No team found' });
    }
    
    const teamId = userTeams[0].team_id;
    const userTeam = userTeams[0];
    
    // Get current draft status
    const draftStatus = await this.getDraftStatus();
    if (!draftStatus.is_active) {
      return res.status(400).json({ success: false, message: 'Draft is not active' });
    }
    
    // Verify it's this team's turn
    const currentPick = await this.getCurrentPick();
    if (!currentPick || currentPick.fantasy_team_id !== teamId) {
      return res.status(400).json({ success: false, message: 'Not your turn to pick' });
    }
    
    // Verify player is available
    const player = await db.query(
      `SELECT p.*, dp.pick_id IS NOT NULL as is_drafted
       FROM nfl_players p
       LEFT JOIN draft_picks dp ON p.player_id = dp.player_id AND dp.season = ?
       WHERE p.player_id = ?`,
       [CURRENT_SEASON, playerIdNum]
    );
    
    if (player.length === 0) {
      return res.status(400).json({ success: false, message: 'Player not found' });
    }
    
    if (player[0].is_drafted) {
      return res.status(400).json({ success: false, message: 'Player already drafted' });
    }
    
    // Make the pick
    const overallPick = ((draftStatus.current_round - 1) * 10) + draftStatus.current_pick;
    await db.query(
      'INSERT INTO draft_picks (season, round, pick_number, overall_pick, fantasy_team_id, player_id) VALUES (?, ?, ?, ?, ?, ?)',
      [CURRENT_SEASON, draftStatus.current_round, draftStatus.current_pick, overallPick, teamId, playerIdNum]
    );
    
    // Add player to team roster
    await FantasyTeam.addPlayerToRoster({
      teamId,
      playerIdNum,
      acquisitionType: 'Draft',
      isKeeper: 0,
      userId
    });
    
    // Remove from ALL teams' queues since player is now drafted
    await db.query(
      'DELETE FROM draft_queue WHERE player_id = ?',
      [playerIdNum]
    );
    
    // Advance to next pick
    await this.advanceToNextPick();

    // Emit real-time event to all draft room users
    const io = req.app.get('io');
    const draftNamespace = io.of('/draft');
    draftNamespace.to('draft-room').emit('playerDrafted', {
        player: player[0],
        teamId: teamId,
        teamName: userTeam.team_name,
        round: draftStatus.current_round,
        pickNumber: draftStatus.current_pick,
        overallPick: ((draftStatus.current_round - 1) * 10) + draftStatus.current_pick
    });

    res.json({ success: true, message: 'Pick made successfully', player: player[0] });
    
  } catch (error) {
    console.error('Error making pick:', error.message);
    res.status(500).json({ success: false, message: 'Error making pick' });
  }
};

/**
 * Get draft board data (all picks organized by team and round)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDraftBoard = async (req, res) => {
  try {
    // Get all teams in original draft order
    const teams = await db.query(
      `SELECT ft.team_id, ft.team_name, u.first_name, u.last_name
      FROM fantasy_teams ft
      JOIN users u ON ft.user_id = u.user_id
      ORDER BY ft.team_id`
    );

    // Get all draft picks for current season
    const picks = await db.query(
      `SELECT dp.*, p.display_name, p.position, nt.team_code,
              ft.team_name, ft.team_id
       FROM draft_picks dp
       JOIN nfl_players p ON dp.player_id = p.player_id
       LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
       JOIN fantasy_teams ft ON dp.fantasy_team_id = ft.team_id
       WHERE dp.season = ?
       ORDER BY dp.overall_pick`,
      [CURRENT_SEASON]
    );

    // Get draft order for empty cells with calculated overall pick
    const draftOrder = await db.query(
      `SELECT do.*, ft.team_name, 
              ((do.round - 1) * 10 + do.pick_number) as overall_pick
      FROM draft_order do
      JOIN fantasy_teams ft ON do.fantasy_team_id = ft.team_id
      WHERE do.season = ?
      ORDER BY do.round, do.pick_number`,
      [CURRENT_SEASON]
    );

    res.json({ 
      success: true, 
      teams: teams,
      picks: picks,
      draftOrder: draftOrder
    });

  } catch (error) {
    console.error('Error getting draft board:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving draft board' });
  }
};

/**
 * Get draft chat messages
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getChatMessages = async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const messageLimit = Math.min(parseInt(limit) || 50, 100); // Cap at 100 messages
    
    // Get recent chat messages - using string interpolation for LIMIT to avoid parameter binding issues
    const messages = await db.query(
      `SELECT dc.*, u.username, u.first_name, u.last_name, ft.team_name
       FROM draft_chat dc
       JOIN users u ON dc.user_id = u.user_id
       LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
       ORDER BY dc.created_at DESC
       LIMIT ${messageLimit}`
    );
    
    // Reverse to show oldest first
    messages.reverse();
    
    res.json({ success: true, messages });
    
  } catch (error) {
    console.error('Error getting chat messages:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving chat messages' });
  }
};

/**
 * Send a chat message
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendChatMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.session.user.id;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }
    
    if (message.length > 500) {
      return res.status(400).json({ success: false, message: 'Message too long (max 500 characters)' });
    }
    
    // Insert message into database
    const result = await db.query(
      'INSERT INTO draft_chat (user_id, message, message_type, created_at) VALUES (?, ?, ?, NOW())',
      [userId, message.trim(), 'user']
    );
    
    // Get the complete message data for broadcasting
    const newMessage = await db.query(
      `SELECT dc.*, u.username, u.first_name, u.last_name, ft.team_name
       FROM draft_chat dc
       JOIN users u ON dc.user_id = u.user_id
       LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
       WHERE dc.message_id = ?`,
      [result.insertId]
    );
    
    if (newMessage.length > 0) {
      // Broadcast message to all users in draft room
      const io = req.app.get('io');
      const draftNamespace = io.of('/draft');
      draftNamespace.to('draft-room').emit('chatMessage', newMessage[0]);
    }
    
    res.json({ success: true, message: 'Message sent successfully' });
    
  } catch (error) {
    console.error('Error sending chat message:', error.message);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
};

/**
 * Get team roster data (keepers + draft picks)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTeamRoster = async (req, res) => {
  try {
    const { teamId } = req.query;
    
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Team ID is required' });
    }

    // Get team info
    const teamInfo = await db.query(
      `SELECT ft.team_id, ft.team_name, u.first_name, u.last_name
       FROM fantasy_teams ft
       JOIN users u ON ft.user_id = u.user_id
       WHERE ft.team_id = ?`,
      [teamId]
    );

    if (teamInfo.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Get all players on the team roster
    const players = await db.query(
      `SELECT p.*, nt.team_name, nt.team_code, 
              ftp.acquisition_type, ftp.acquisition_date, ftp.is_keeper,
              CASE 
                WHEN ftp.acquisition_type = 'Draft' AND YEAR(ftp.acquisition_date) = ? THEN 1
                ELSE 0
              END as is_new_draft_pick
       FROM fantasy_team_players ftp
       JOIN nfl_players p ON ftp.player_id = p.player_id
       LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
       WHERE ftp.fantasy_team_id = ?
       ORDER BY 
          CASE 
              WHEN p.position = 'QB' THEN 1
              WHEN p.position = 'RB' THEN 2
              WHEN p.position = 'RC' THEN 3
              WHEN p.position = 'PK' THEN 4
              WHEN p.position = 'DU' THEN 5
              ELSE 6
          END,
          is_new_draft_pick ASC,
          p.last_name, p.first_name`,
      [CURRENT_SEASON, teamId]
    );

    // Group players by position
    const rosterByPosition = {
      QB: [],
      RB: [],
      RC: [],
      PK: [],
      DU: []
    };

    players.forEach(player => {
      if (rosterByPosition[player.position]) {
        rosterByPosition[player.position].push(player);
      }
    });

    // Calculate roster stats
    const totalPlayers = players.length;
    const keeperCount = players.filter(p => !p.is_new_draft_pick).length;
    const draftPickCount = players.filter(p => p.is_new_draft_pick).length;

    res.json({ 
      success: true, 
      team: teamInfo[0],
      roster: rosterByPosition,
      stats: {
        totalPlayers,
        keeperCount,
        draftPickCount
      }
    });

  } catch (error) {
    console.error('Error getting team roster:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving team roster' });
  }
};

// Helper Methods

/**
 * Get current draft status
 * @returns {Promise<Object>} Draft status object
 */
exports.getDraftStatus = async () => {
  try {
    const status = await db.query('SELECT * FROM draft_status WHERE season = ? ORDER BY status_id DESC LIMIT 1', [CURRENT_SEASON]);
    return status[0] || { is_active: false, current_round: 1, current_pick: 1 };
  } catch (error) {
    console.error('Error getting draft status:', error.message);
    return { is_active: false, current_round: 1, current_pick: 1 };
  }
};

/**
 * Get current pick information
 * @returns {Promise<Object>} Current pick object
 */
exports.getCurrentPick = async () => {
  try {
    const draftStatus = await this.getDraftStatus();
    const currentPick = await db.query(
      'SELECT * FROM draft_order WHERE round = ? AND pick_number = ?',
      [draftStatus.current_round, draftStatus.current_pick]
    );
    return currentPick[0] || null;
  } catch (error) {
    console.error('Error getting current pick:', error.message);
    return null;
  }
};

/**
 * Get user's draft queue
 * @param {number} teamId - Team ID
 * @returns {Promise<Array>} Queue array
 */
exports.getUserQueue = async (teamId) => {
  try {
    const queue = await db.query(
      `SELECT dq.*, p.display_name, p.position, nt.team_code
       FROM draft_queue dq
       JOIN nfl_players p ON dq.player_id = p.player_id
       LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
       WHERE dq.fantasy_team_id = ?
       ORDER BY dq.queue_order`,
      [teamId]
    );
    return queue;
  } catch (error) {
    console.error('Error getting user queue:', error.message);
    return [];
  }
};

/**
 * Advance to next pick in draft order
 */
exports.advanceToNextPick = async () => {
  try {
    const draftStatus = await this.getDraftStatus();
    let { current_round, current_pick } = draftStatus;
    
    // Check if there are more picks in current round
    const nextPickInRound = await db.query(
      'SELECT * FROM draft_order WHERE round = ? AND pick_number = ?',
      [current_round, current_pick + 1]
    );
    
    if (nextPickInRound.length > 0) {
      // Move to next pick in same round
      current_pick += 1;
    } else {
      // Move to next round, first pick
      current_round += 1;
      current_pick = 1;
      
      // Check if next round exists
      const nextRound = await db.query(
        'SELECT * FROM draft_order WHERE round = ?',
        [current_round]
      );
      
      if (nextRound.length === 0) {
        // Draft is complete
        await db.query(
          'UPDATE draft_status SET is_active = 0, end_time = NOW() WHERE status_id = ?',
          [draftStatus.status_id]
        );
        return;
      }
    }
    
    // Update draft status
    await db.query(
      'UPDATE draft_status SET current_round = ?, current_pick = ? WHERE status_id = ?',
      [current_round, current_pick, draftStatus.status_id]
    );
    
  } catch (error) {
    console.error('Error advancing to next pick:', error.message);
  }
};

/**
 * Reorder queue items after deletion
 * @param {number} teamId - Team ID
 */
exports.reorderQueueItems = async (teamId) => {
  try {
    const queueItems = await db.query(
      'SELECT * FROM draft_queue WHERE fantasy_team_id = ? ORDER BY queue_order',
      [teamId]
    );
    
    for (let i = 0; i < queueItems.length; i++) {
      await db.query(
        'UPDATE draft_queue SET queue_order = ? WHERE queue_id = ?',
        [i + 1, queueItems[i].queue_id]
      );
    }
  } catch (error) {
    console.error('Error reordering queue items:', error.message);
  }
};