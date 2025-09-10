/**
 * Admin Controller
 * Handles admin functionality, including player management
 */

const Player = require('../models/player');
const NFLTeam = require('../models/nflTeam');
const ScheduleAssignment = require('../models/ScheduleAssignment');
const WeeklySchedule = require('../models/WeeklySchedule');
const ScheduleNote = require('../models/ScheduleNote');
const FantasyTeam = require('../models/FantasyTeam');
const User = require('../models/user');
const LineupLock = require('../models/LineupLock');
const db = require('../config/database');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { validationResult } = require('express-validator');

/**
 * Display admin dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDashboard = async (req, res) => {
  try {
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      user: req.session.user,
      activePage: 'admin'
    });
  } catch (error) {
    console.error('Error displaying admin dashboard:', error.message);
    req.flash('error_msg', 'Error loading admin dashboard');
    res.redirect('/dashboard');
  }
};

/**
 * Display NFL players management page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPlayerManagement = async (req, res) => {
  try {
    // Get players with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const options = {
      limit,
      offset,
      sortBy: 'last_name',
      sortDir: 'ASC'
    };
    
    // Apply search filters if provided
    if (req.query.search) {
      options.nameSearch = req.query.search;
    }
    
    if (req.query.position) {
      options.position = req.query.position;
    }
    
    // Get players and total count
    const [players, totalCount] = await Promise.all([
      Player.getAll(options),
      Player.count(options)
    ]);
    
    // Get NFL teams for dropdown
    const teams = await NFLTeam.getAll();
    
    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    
    res.render('admin/player-upload', {
      title: 'NFL Player Management',
      players,
      teams,
      activePage: 'admin',
      search: req.query.search || '',
      position: req.query.position || '',
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit
      },
      user: req.session.user
    });
  } catch (error) {
    console.error('Error displaying player management:', error.message);
    req.flash('error_msg', 'Error loading player management');
    res.redirect('/admin');
  }
};

/**
 * Display NFL player CSV upload page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPlayerUpload = async (req, res) => {
  try {
    const teams = await NFLTeam.getAll();
    
    res.render('admin/player-upload', {
      title: 'Upload NFL Players',
      teams,
      user: req.session.user,
      activePage: 'admin'
    });
  } catch (error) {
    console.error('Error displaying player upload page:', error.message);
    req.flash('error_msg', 'Error loading upload page');
    res.redirect('/admin/players');
  }
};

/**
 * Process NFL player CSV upload
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.processPlayerUpload = async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error_msg', 'No file uploaded');
      return res.redirect('/admin/players/upload');
    }
    
    // Get file path
    const filePath = req.file.path;
    
    // Get NFL teams for mapping team codes to IDs
    const teams = await NFLTeam.getAll();
    const teamMap = {};
    
    teams.forEach(team => {
      teamMap[team.team_code] = team.nfl_team_id;
    });
    
    // Track results
    let processed = 0;
    let added = 0;
    let errors = 0;
    const errorMessages = [];
    
    // Process CSV file
    const players = [];
    
    // Create a read stream and process the file
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Check if the row is a header row
        if (row.first_name && row.first_name.trim().toLowerCase() === 'first_name') {
          // Skip this row
          return;
        }
        
        processed++;
        
        // Basic validation
        if (!row.first_name || !row.last_name || !row.position) {
          errors++;
          errorMessages.push(`Row ${processed}: Missing required fields (first_name, last_name, position)`);
          return;
        }
        
        // Create player object
        const player = {
            firstName: row.first_name.trim(),
            lastName: row.last_name.trim(),
            displayName: row.display_name ? row.display_name.trim() : `${row.first_name.trim()} ${row.last_name.trim()}`,
            nflTeamId: row.nfl_team_code ? teamMap[row.nfl_team_code] : null,
            position: row.position.trim(),
            userId: req.session.user.id
          };
        
        players.push(player);
      })
      .on('end', async () => {
        // Delete the temporary file
        fs.unlinkSync(filePath);
        
        // Process each player
        for (const player of players) {
          try {
            await Player.create(player);
            added++;
          } catch (err) {
            errors++;
            errorMessages.push(`Error adding ${player.firstName} ${player.lastName}: ${err.message}`);
          }
        }
        
        // Show results
        if (errors > 0) {
          req.flash('error_msg', `Processed ${processed} players. Added ${added}, but encountered ${errors} errors.`);
          // Store error details in session for display
          req.session.uploadErrors = errorMessages;
        } else {
          req.flash('success_msg', `Successfully added ${added} players to the database.`);
        }
        
        res.redirect('/admin/players');
      })
      .on('error', (err) => {
        console.error('Error processing CSV:', err);
        req.flash('error_msg', 'Error processing CSV file: ' + err.message);
        res.redirect('/admin/players/upload');
      });
    
  } catch (error) {
    console.error('Error uploading players:', error.message);
    req.flash('error_msg', 'Error uploading players: ' + error.message);
    res.redirect('/admin/players/upload');
  }
};

/**
 * Display form to add a new NFL player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAddPlayer = async (req, res) => {
  try {
    const teams = await NFLTeam.getAll();
    
    res.render('admin/player-form', {
      title: 'Add NFL Player',
      teams,
      player: {},
      activePage: 'admin',
      formAction: '/admin/players/add',
      user: req.session.user
    });
  } catch (error) {
    console.error('Error displaying add player form:', error.message);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/admin/players');
  }
};

/**
 * Process adding a new NFL player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.addPlayer = async (req, res) => {
  try {
    // Validate form data
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const teams = await NFLTeam.getAll();
      
      return res.render('admin/player-form', {
        title: 'Add NFL Player',
        teams,
        player: req.body,
        activePage: 'admin',
        errors: errors.array(),
        formAction: '/admin/players/add',
        user: req.session.user
      });
    }
    
    // Create player object
    const player = {
      firstName: req.body.firstName.trim(),
      lastName: req.body.lastName.trim(),
      displayName: req.body.displayName ? req.body.displayName.trim() : `${req.body.firstName.trim()} ${req.body.lastName.trim()}`,
      nflTeamId: req.body.nflTeamId || null,
      position: req.body.position.trim(),
      userId: req.session.user.id
    };
    
    // Add player to database
    const playerId = await Player.create(player);
    
    if (!playerId) {
      throw new Error('Player creation failed - no ID returned');
    }
    
    req.flash('success_msg', `Player ${player.displayName} added successfully`);
    res.redirect('/admin/players');
  } catch (error) {
    console.error('Error adding player:', error.message);
    req.flash('error_msg', 'Error adding player: ' + error.message);
    res.redirect('/admin/players/add');
  }
};

/**
 * Display form to edit an NFL player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEditPlayer = async (req, res) => {
  try {
    const playerId = req.params.id;
    const [player, teams] = await Promise.all([
      Player.findById(playerId),
      NFLTeam.getAll()
    ]);
    
    if (!player) {
      req.flash('error_msg', 'Player not found');
      return res.redirect('/admin/players');
    }
    
    res.render('admin/player-form', {
      title: `Edit Player: ${player.display_name}`,
      teams,
      player,
      activePage: 'admin',
      formAction: `/admin/players/edit/${playerId}`,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error displaying edit player form:', error.message);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/admin/players');
  }
};

/**
 * Process editing an NFL player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.editPlayer = async (req, res) => {
  try {
    const playerId = req.params.id;
    
    // Validate form data
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const teams = await NFLTeam.getAll();
      
      return res.render('admin/player-form', {
        title: `Edit Player`,
        teams,
        activePage: 'admin',
        player: {
          ...req.body,
          player_id: playerId
        },
        errors: errors.array(),
        formAction: `/admin/players/edit/${playerId}`,
        user: req.session.user
      });
    }
    
    // Update player object
    const player = {
      firstName: req.body.firstName.trim(),
      lastName: req.body.lastName.trim(),
      displayName: req.body.displayName ? req.body.displayName.trim() : `${req.body.firstName.trim()} ${req.body.lastName.trim()}`,
      nflTeamId: req.body.nflTeamId || null,
      position: req.body.position.trim(),
    };
    
    // Update player in database
    const updated = await Player.update(playerId, player, req.session.user.id);
    
    if (updated) {
      req.flash('success_msg', `Player ${player.displayName} updated successfully`);
    } else {
      req.flash('error_msg', 'Player not found or not updated');
    }
    
    res.redirect('/admin/players');
  } catch (error) {
    console.error('Error updating player:', error.message);
    req.flash('error_msg', 'Error updating player: ' + error.message);
    res.redirect(`/admin/players/edit/${req.params.id}`);
  }
};

/**
 * Delete an NFL player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deletePlayer = async (req, res) => {
  try {
    const playerId = req.params.id;
    
    // Delete player from database
    const deleted = await Player.delete(playerId, req.session.user.id);
    
    if (deleted) {
      req.flash('success_msg', 'Player deleted successfully');
    } else {
      req.flash('error_msg', 'Player not found or could not be deleted');
    }
    
    res.redirect('/admin/players');
  } catch (error) {
    console.error('Error deleting player:', error.message);
    req.flash('error_msg', 'Error deleting player: ' + error.message);
    res.redirect('/admin/players');
  }
};

/**
 * Undo the last draft pick
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.undoLastPick = async (req, res) => {
  const db = require('../config/database');
  let connection;
  
  try {
    // Get a connection from the pool for transaction control
    connection = await db.pool.getConnection();
    
    // Start transaction
    await connection.beginTransaction();
    
    // Find the most recent draft pick
    const lastPickQuery = `
      SELECT dp.*, ft.team_name, p.display_name, p.position
      FROM draft_picks dp
      JOIN fantasy_teams ft ON dp.fantasy_team_id = ft.team_id
      JOIN nfl_players p ON dp.player_id = p.player_id
      WHERE dp.season = ?
      ORDER BY dp.overall_pick DESC 
      LIMIT 1
    `;
    
    const [lastPickRows] = await connection.execute(lastPickQuery, [2025]);
    
    if (lastPickRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'No draft picks found to undo'
      });
    }
    
    const pick = lastPickRows[0];
    
    // Remove player from fantasy team roster
    await connection.execute(
      'DELETE FROM fantasy_team_players WHERE fantasy_team_id = ? AND player_id = ?',
      [pick.fantasy_team_id, pick.player_id]
    );
    
    // Delete the draft pick
    await connection.execute('DELETE FROM draft_picks WHERE pick_id = ?', [pick.pick_id]);
    
    // Update the draft status to go back to this pick
    await connection.execute(`
      UPDATE draft_status 
      SET current_round = ?, current_pick = ?
      WHERE season = ?
    `, [pick.round, pick.pick_number, 2025]);
    
    // Commit the transaction
    await connection.commit();
    connection.release();
    
    // Emit real-time event to all draft room users
    const io = req.app.get('io');
    if (io) {
      const draftNamespace = io.of('/draft');
      draftNamespace.to('draft-room').emit('pickUndone', {
        undonePlayer: {
          display_name: pick.display_name,
          position: pick.position
        },
        teamName: pick.team_name,
        overallPick: pick.overall_pick,
        round: pick.round,
        pickNumber: pick.pick_number
      });
    }
    
    res.json({
      success: true,
      message: `Successfully undid pick #${pick.overall_pick}: ${pick.display_name} (${pick.position}) from ${pick.team_name}`
    });
    
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('Error undoing last pick:', error);
    res.status(500).json({
      success: false,
      message: 'Error undoing last pick: ' + error.message
    });
  }
};

/**
 * Display schedule management interface
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScheduleManagement = async (req, res) => {
  try {
    const seasonYear = 2025;
    
    // Initialize with empty arrays in case of database errors
    let assignments = [];
    let allTeams = [];
    let unassignedTeams = [];
    let scheduleNotes = [];
    let scheduleStats = { total_games: 0, primary_games: 0, bonus_games: 0, total_weeks: 0 };
    
    try {
      // Fetch all current team assignments
      assignments = await ScheduleAssignment.getAllAssignments(seasonYear);
      
      // Fetch all fantasy teams
      allTeams = await FantasyTeam.getAll();
      
      // Find unassigned teams
      const assignedTeamIds = assignments.map(a => a.fantasy_team_id);
      unassignedTeams = allTeams.filter(team => !assignedTeamIds.includes(team.team_id));
      
      // Fetch schedule notes
      scheduleNotes = await ScheduleNote.getAllActiveNotes(seasonYear);
      
      // Get schedule statistics
      scheduleStats = await WeeklySchedule.getScheduleStats(seasonYear);
    } catch (dbError) {
      console.error('Database error in schedule management:', dbError.message);
      // Continue with empty data to show the interface
    }
    
    res.render('admin/schedules', {
      title: 'Schedule Management',
      user: req.session.user,
      activePage: 'admin',
      assignments: assignments || [],
      unassignedTeams: unassignedTeams || [],
      scheduleNotes: scheduleNotes || [],
      scheduleStats: scheduleStats || { total_games: 0, primary_games: 0, bonus_games: 0, total_weeks: 0 },
      seasonYear
    });
  } catch (error) {
    console.error('Error displaying schedule management:', error.message);
    req.flash('error_msg', 'Error loading schedule management');
    res.redirect('/admin');
  }
};

/**
 * Display trade approval dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTradeApprovals = async (req, res) => {
  try {
    res.render('admin/trades', {
      title: 'Trade Approvals',
      user: req.session.user,
      activePage: 'admin'
    });
  } catch (error) {
    console.error('Error displaying trade approvals:', error.message);
    req.flash('error_msg', 'Error loading trade approvals');
    res.redirect('/admin');
  }
};

/**
 * Display waiver wire approval interface
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getWaiverApprovals = async (req, res) => {
  // Redirect to the new waiver admin page
  res.redirect('/waivers/admin');
};

/**
 * Display user management panel
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserManagement = async (req, res) => {
  try {
    // Get all users with their fantasy teams and recent activity
    const users = await User.getAllWithDetails();
    
    // Get user statistics
    const stats = await User.getStatistics();

    res.render('admin/users', {
      title: 'User Management',
      user: req.session.user,
      activePage: 'admin',
      users: users || [],
      stats: stats || { total_users: 0, active_users: 0, admin_users: 0, recent_active: 0 }
    });
  } catch (error) {
    console.error('Error displaying user management:', error.message);
    req.flash('error_msg', 'Error loading user management');
    res.redirect('/admin');
  }
};

/**
 * Reset user password (Admin function)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.resetUserPassword = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'User ID and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Update the password
    console.log(`Admin resetting password for user ${userId} with password length: ${newPassword.length}`);
    const updated = await User.update(userId, { password: newPassword });

    if (updated) {
      // Log the activity
      const db = require('../config/database');
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.session.user.id, 'PASSWORD_RESET', 'USER', userId, `Admin reset password for user ID ${userId}`]
      );

      console.log(`Password reset successful for user ${userId}`);
      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } else {
      console.log(`Password reset failed for user ${userId} - user not found or not updated`);
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error resetting password:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error resetting password: ' + error.message
    });
  }
};

/**
 * Toggle user admin status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.toggleUserAdmin = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { isAdmin } = req.body;

    if (!userId || typeof isAdmin !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'User ID and admin status are required'
      });
    }

    // Prevent user from removing their own admin privileges
    if (userId === req.session.user.id && !isAdmin) {
      return res.status(400).json({
        success: false,
        message: 'You cannot remove your own admin privileges'
      });
    }

    const db = require('../config/database');
    const result = await db.query(
      'UPDATE users SET is_admin = ? WHERE user_id = ?',
      [isAdmin ? 1 : 0, userId]
    );

    if (result.affectedRows > 0) {
      // Log the activity
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.session.user.id, 'ADMIN_STATUS_CHANGED', 'USER', userId, `Admin status ${isAdmin ? 'granted' : 'revoked'} for user ID ${userId}`]
      );

      res.json({
        success: true,
        message: `Admin status ${isAdmin ? 'granted' : 'revoked'} successfully`
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error toggling admin status:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error updating admin status: ' + error.message
    });
  }
};

/**
 * Toggle user active status
 * @param {Object} req - Express request object  
 * @param {Object} res - Express response object
 */
exports.toggleUserStatus = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { isActive } = req.body;

    if (!userId || typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'User ID and status are required'
      });
    }

    // Prevent user from disabling their own account
    if (userId === req.session.user.id && !isActive) {
      return res.status(400).json({
        success: false,
        message: 'You cannot disable your own account'
      });
    }

    const success = await User.toggleActiveStatus(userId, isActive);

    if (success) {
      // Log the activity
      const db = require('../config/database');
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.session.user.id, 'USER_STATUS_CHANGED', 'USER', userId, `User account ${isActive ? 'enabled' : 'disabled'} for user ID ${userId}`]
      );

      res.json({
        success: true,
        message: `User account ${isActive ? 'enabled' : 'disabled'} successfully`
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error toggling user status:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error updating user status: ' + error.message
    });
  }
};

/**
 * Get user login history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserLoginHistory = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const db = require('../config/database');
    const loginHistory = await db.query(`
      SELECT 
        lh.login_time,
        lh.ip_address,
        lh.user_agent,
        lh.login_status
      FROM login_history lh
      WHERE lh.user_id = ?
      ORDER BY lh.login_time DESC
      LIMIT 50
    `, [userId]);

    res.json({
      success: true,
      loginHistory
    });
  } catch (error) {
    console.error('Error fetching login history:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching login history: ' + error.message
    });
  }
};

/**
 * Get user activity logs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserActivity = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const db = require('../config/database');
    const activityLogs = await db.query(`
      SELECT 
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.details,
        al.created_at,
        lc.category_name
      FROM activity_logs al
      LEFT JOIN log_categories lc ON al.category_id = lc.category_id
      WHERE al.user_id = ?
      ORDER BY al.created_at DESC
      LIMIT 100
    `, [userId]);

    res.json({
      success: true,
      activityLogs
    });
  } catch (error) {
    console.error('Error fetching user activity:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching user activity: ' + error.message
    });
  }
};

/**
 * Update user profile information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateUserProfile = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { firstName, lastName, email, username } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Check if email or username already exists for other users
    if (email || username) {
      const db = require('../config/database');
      const existingUser = await db.query(
        'SELECT user_id FROM users WHERE (email = ? OR username = ?) AND user_id != ?',
        [email || '', username || '', userId]
      );

      if (existingUser.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email or username already exists'
        });
      }
    }

    // Update user
    const updateData = {};
    if (firstName) updateData.firstName = firstName.trim();
    if (lastName) updateData.lastName = lastName.trim();
    if (email) updateData.email = email.trim();
    if (username) updateData.username = username.trim();

    const updated = await User.update(userId, updateData);

    if (updated) {
      // Log the activity
      const db = require('../config/database');
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.session.user.id, 'USER_PROFILE_UPDATED', 'USER', userId, `Admin updated profile for user ID ${userId}`]
      );

      res.json({
        success: true,
        message: 'User profile updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error updating user profile:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error updating user profile: ' + error.message
    });
  }
};

/**
 * Display league settings configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getLeagueSettings = async (req, res) => {
  try {
    res.render('admin/settings', {
      title: 'League Settings',
      user: req.session.user,
      activePage: 'admin'
    });
  } catch (error) {
    console.error('Error displaying league settings:', error.message);
    req.flash('error_msg', 'Error loading league settings');
    res.redirect('/admin');
  }
};

/**
 * Display activity log viewer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getActivityLogs = async (req, res) => {
  try {
    res.render('admin/logs', {
      title: 'Activity Logs',
      user: req.session.user,
      activePage: 'admin'
    });
  } catch (error) {
    console.error('Error displaying activity logs:', error.message);
    req.flash('error_msg', 'Error loading activity logs');
    res.redirect('/admin');
  }
};

/**
 * Display data import/export tools
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getImportExport = async (req, res) => {
  try {
    res.render('admin/import-export', {
      title: 'Import/Export Tools',
      user: req.session.user,
      activePage: 'admin'
    });
  } catch (error) {
    console.error('Error displaying import/export tools:', error.message);
    req.flash('error_msg', 'Error loading import/export tools');
    res.redirect('/admin');
  }
};

/**
 * Update team position assignments (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateTeamAssignments = async (req, res) => {
  try {
    const { assignments } = req.body;
    const seasonYear = 2025;
    
    if (!assignments || !Array.isArray(assignments)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignments data'
      });
    }
    
    // Validate assignments
    for (const assignment of assignments) {
      if (!assignment.schedule_position || assignment.schedule_position < 1 || assignment.schedule_position > 10) {
        return res.status(400).json({
          success: false,
          message: 'Invalid position number'
        });
      }
    }
    
    // Update assignments using bulk update
    await ScheduleAssignment.bulkUpdateAssignments(assignments, seasonYear);
    
    res.json({
      success: true,
      message: 'Team assignments updated successfully'
    });
  } catch (error) {
    console.error('Error updating team assignments:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating assignments: ' + error.message
    });
  }
};

/**
 * Get schedule preview with team names (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getSchedulePreview = async (req, res) => {
  try {
    const seasonYear = 2025;
    
    // Get schedule with team names
    const scheduleWithTeams = await WeeklySchedule.getScheduleWithTeams(seasonYear);
    
    // Get schedule notes
    const scheduleNotes = await ScheduleNote.getAllActiveNotes(seasonYear);
    
    res.json({
      success: true,
      schedule: scheduleWithTeams,
      notes: scheduleNotes
    });
  } catch (error) {
    console.error('Error getting schedule preview:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading schedule preview: ' + error.message
    });
  }
};

/**
 * Create a new schedule note (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.createScheduleNote = async (req, res) => {
  try {
    const { week_number, note_text, note_type, display_order } = req.body;
    const seasonYear = 2025;
    
    if (!week_number || !note_text) {
      return res.status(400).json({
        success: false,
        message: 'Week number and note text are required'
      });
    }
    
    const noteData = {
      week_number: parseInt(week_number),
      note_text: note_text.trim(),
      note_type: note_type || 'announcement',
      season_year: seasonYear
    };
    
    const note = await ScheduleNote.createNote(noteData);
    
    res.json({
      success: true,
      message: 'Schedule note created successfully',
      note
    });
  } catch (error) {
    console.error('Error creating schedule note:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating note: ' + error.message
    });
  }
};

/**
 * Update an existing schedule note (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateScheduleNote = async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const { note_text, note_type, is_active } = req.body;
    
    if (!noteId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid note ID'
      });
    }
    
    const updateData = {};
    if (note_text !== undefined) updateData.note_text = note_text.trim();
    if (note_type !== undefined) updateData.note_type = note_type;
    if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;
    
    const updated = await ScheduleNote.updateNote(noteId, updateData);
    
    if (updated) {
      res.json({
        success: true,
        message: 'Schedule note updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }
  } catch (error) {
    console.error('Error updating schedule note:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating note: ' + error.message
    });
  }
};

/**
 * Delete a schedule note (AJAX endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deleteScheduleNote = async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    
    if (!noteId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid note ID'
      });
    }
    
    const deleted = await ScheduleNote.deleteNote(noteId);
    
    if (deleted) {
      res.json({
        success: true,
        message: 'Schedule note deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }
  } catch (error) {
    console.error('Error deleting schedule note:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting note: ' + error.message
    });
  }
};

/**
 * Display draft order management page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDraftOrder = async (req, res) => {
  try {
    // Get teams in their current draft order (based on round 1 positions)
    const teams = await db.query(`
      SELECT DISTINCT ft.team_id, ft.team_name, ft.user_id, u.username, u.first_name, u.last_name,
             do.pick_number as draft_position
      FROM draft_order do
      JOIN fantasy_teams ft ON do.original_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id 
      WHERE do.season = 2025 AND do.round = 1
      ORDER BY do.pick_number
    `);
    
    // Get current draft order with calculated overall pick
    const draftOrder = await db.query(`
      SELECT do.*, 
             ft.team_name as current_team_name,
             orig_ft.team_name as original_team_name,
             ((do.round - 1) * 10 + do.pick_number) as overall_pick
      FROM draft_order do 
      LEFT JOIN fantasy_teams ft ON do.fantasy_team_id = ft.team_id
      LEFT JOIN fantasy_teams orig_ft ON do.original_team_id = orig_ft.team_id
      WHERE do.season = 2025 
      ORDER BY do.round, do.pick_number
    `);
    
    // Get league settings for round count
    const leagueSettings = await db.query(`
      SELECT draft_rounds, teams_count FROM league_settings 
      WHERE season_year = 2025
    `);
    
    res.render('admin/draft-order', {
      teams,
      draftOrder,
      rounds: leagueSettings[0]?.draft_rounds || 9,
      teamsCount: leagueSettings[0]?.teams_count || 10,
      title: 'Draft Order Management'
    });
  } catch (error) {
    console.error('Error loading draft order page:', error);
    req.flash('error_msg', 'Error loading draft order page');
    res.redirect('/admin');
  }
};

/**
 * Get draft order data as JSON
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDraftOrderData = async (req, res) => {
  try {
    // Get teams with user info
    const teams = await db.query(`
      SELECT ft.team_id, ft.team_name, ft.user_id, u.username, u.first_name, u.last_name
      FROM fantasy_teams ft 
      JOIN users u ON ft.user_id = u.user_id 
      ORDER BY ft.team_id
    `);
    
    // Get current draft order and traded picks
    const draftOrder = await db.query(`
      SELECT do.*,
             ft.team_name as current_team_name,
             orig_ft.team_name as original_team_name,
             ((do.round - 1) * 10 + do.pick_number) as overall_pick
      FROM draft_order do 
      LEFT JOIN fantasy_teams ft ON do.fantasy_team_id = ft.team_id
      LEFT JOIN fantasy_teams orig_ft ON do.original_team_id = orig_ft.team_id
      WHERE season = 2025 
      ORDER BY round, pick_number
    `);
    
    // Get league settings for round count
    const leagueSettings = await db.query(`
      SELECT draft_rounds, teams_count FROM league_settings 
      WHERE season_year = 2025
    `);
    
    res.json({
      success: true,
      teams,
      draftOrder,
      rounds: leagueSettings[0]?.draft_rounds || 9,
      teamsCount: leagueSettings[0]?.teams_count || 10
    });
  } catch (error) {
    console.error('Error getting draft order data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update draft order with new team positions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateDraftOrder = async (req, res) => {
  try {
    const { teamOrder } = req.body; // Array of team_ids in new draft position order
    
    if (!Array.isArray(teamOrder) || teamOrder.length !== 10) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid team order. Must provide exactly 10 teams.' 
      });
    }
    
    // Get league settings
    const [settings] = await db.query(`
      SELECT draft_rounds, teams_count FROM league_settings 
      WHERE season_year = 2025
    `);
    
    const { draft_rounds, teams_count } = settings;
    
    // Get a connection from the pool for transaction handling
    const connection = await db.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Get current draft order with all picks and their ownership
      const [allPicks] = await connection.execute(`
        SELECT * FROM draft_order 
        WHERE season = 2025 
        ORDER BY round, pick_number
      `);
      
      // Create a mapping: team_id -> new position (1-10)
      const teamToNewPosition = {};
      teamOrder.forEach((teamId, index) => {
        teamToNewPosition[teamId] = index + 1; // 1-indexed positions
      });
      
      console.log('Team position mapping:', teamToNewPosition);
      
      // Build a map of all current trades (team X's round Y pick -> owner)
      const tradeMap = {};
      for (const pick of allPicks) {
        if (pick.fantasy_team_id !== pick.original_team_id) {
          const key = `${pick.original_team_id}_${pick.round}`;
          tradeMap[key] = pick.fantasy_team_id;
        }
      }
      
      console.log('Current trades:', tradeMap);
      
      // Create a new draft order structure
      const newDraftOrder = [];
      
      // For each round and position, determine what should be there
      for (let round = 1; round <= draft_rounds; round++) {
        for (let position = 1; position <= teams_count; position++) {
          // The team now assigned to this position
          const newTeamAtPosition = teamOrder[position - 1]; // teamOrder is 0-indexed
          
          // Check if this team's pick for this round was traded
          const tradeKey = `${newTeamAtPosition}_${round}`;
          const currentOwner = tradeMap[tradeKey] || newTeamAtPosition;
          
          newDraftOrder.push({
            round,
            pick_number: position,
            original_team_id: newTeamAtPosition,
            fantasy_team_id: currentOwner
          });
        }
      }
      
      // Clear existing draft order and rebuild
      await connection.execute('DELETE FROM draft_order WHERE season = 2025');
      
      // Insert new draft order
      for (const pick of newDraftOrder) {
        await connection.execute(`
          INSERT INTO draft_order (round, pick_number, fantasy_team_id, original_team_id, season)
          VALUES (?, ?, ?, ?, 2025)
        `, [pick.round, pick.pick_number, pick.fantasy_team_id, pick.original_team_id]);
      }
      
      await connection.commit();
      
      // Log the changes for verification
      const tradedPicksCount = allPicks.filter(p => p.fantasy_team_id !== p.original_team_id).length;
      console.log(`Draft order updated. ${tradedPicksCount} traded picks preserved.`);
      
      res.json({ 
        success: true, 
        message: `Draft order updated successfully. ${tradedPicksCount} traded picks moved with their original teams.` 
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error updating draft order:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * Display player audit interface
 * @param {Object} req - Express request object  
 * @param {Object} res - Express response object
 */
exports.getPlayerAudit = async (req, res) => {
  try {
    res.render('admin/player-audit', {
      title: 'Player Team Audit',
      activePage: 'admin',
      user: req.session.user
    });
  } catch (error) {
    console.error('Error getting player audit:', error);
    res.status(500).render('error', { message: 'Error loading player audit' });
  }
};

/**
 * Fix player team assignments  
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 */
exports.fixPlayerTeams = async (req, res) => {
  try {
    res.json({ success: true, message: 'Player team fixes not yet implemented' });
  } catch (error) {
    console.error('Error fixing player teams:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Display lineup lock management page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getLineupLockManagement = async (req, res) => {
  try {
    // Get current lock status for all weeks
    const lockStatus = await LineupLock.getAllWeeksStatus(2025);
    
    res.render('admin/lineup-locks', {
      title: 'Lineup Lock Management',
      user: req.session.user,
      activePage: 'admin',
      lockStatus
    });
  } catch (error) {
    console.error('Error displaying lineup lock management:', error.message);
    req.flash('error_msg', 'Error loading lineup lock management');
    res.redirect('/admin');
  }
};

/**
 * Set lock time for a specific week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.setLineupLockTime = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { week_number, lock_datetime } = req.body;
    const seasonYear = 2025;

    // Convert the datetime to UTC for storage
    const lockTime = new Date(lock_datetime);
    
    if (isNaN(lockTime.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date/time format'
      });
    }

    // Set the lock time
    const success = await LineupLock.setLockTime(week_number, seasonYear, lockTime);

    if (success) {
      res.json({ 
        success: true, 
        message: `Lock time set for Week ${week_number}`,
        lockTime: lockTime.toISOString()
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to set lock time' 
      });
    }
  } catch (error) {
    console.error('Error setting lineup lock time:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * Manually lock/unlock a specific week
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.toggleLineupLock = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { week_number, is_locked } = req.body;
    const seasonYear = 2025;

    // Toggle the lock status
    const success = await LineupLock.setLockStatus(week_number, seasonYear, is_locked);

    if (success) {
      const status = is_locked ? 'locked' : 'unlocked';
      res.json({ 
        success: true, 
        message: `Week ${week_number} ${status}`,
        isLocked: is_locked
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to update lock status' 
      });
    }
  } catch (error) {
    console.error('Error toggling lineup lock:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * Get lineup lock data for AJAX
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getLineupLockData = async (req, res) => {
  try {
    const lockStatus = await LineupLock.getAllWeeksStatus(2025);
    
    res.json({
      success: true,
      data: lockStatus
    });
  } catch (error) {
    console.error('Error getting lineup lock data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * Display standings management interface
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getStandingsManagement = async (req, res) => {
  try {
    const seasonYear = 2025;
    
    // Get current standings with team and user information
    const standings = await db.query(`
      SELECT 
        ls.*,
        ft.team_name,
        u.first_name,
        u.last_name
      FROM league_standings ls
      JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      WHERE ls.season_year = ?
      ORDER BY 
        ls.position ASC
    `, [seasonYear]);
    
    res.render('admin/standings', {
      title: 'Manage Standings | Admin | GBRFL',
      activePage: 'admin',
      standings: standings,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading standings management:', error);
    req.flash('error_msg', 'Error loading standings management');
    res.redirect('/admin');
  }
};

/**
 * Update league standings
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateStandings = async (req, res) => {
  try {
    const { teams } = req.body;
    const seasonYear = 2025;
    
    if (!teams || !Array.isArray(teams)) {
      req.flash('error_msg', 'Invalid team data provided');
      return res.redirect('/admin/standings');
    }
    
    // Update each team's standings
    for (const team of teams) {
      await db.query(`
        UPDATE league_standings 
        SET 
          wins = ?,
          losses = ?,
          points_differential = ?,
          games_behind = ?,
          position = ?,
          updated_at = NOW()
        WHERE fantasy_team_id = ? AND season_year = ?
      `, [
        team.wins,
        team.losses,
        team.points_differential,
        team.games_behind,
        team.position,
        team.fantasy_team_id,
        seasonYear
      ]);
    }
    
    req.flash('success_msg', 'Standings updated successfully');
    res.redirect('/admin/standings');
  } catch (error) {
    console.error('Error updating standings:', error);
    req.flash('error_msg', 'Error updating standings');
    res.redirect('/admin/standings');
  }
};

