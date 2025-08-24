/**
 * Player Controller
 * Handles all player-related functionality
 */

const Player = require('../models/player');
const NFLTeam = require('../models/nflTeam');
const FantasyTeam = require('../models/FantasyTeam');
const { validationResult } = require('express-validator');

/**
 * Get all players with pagination and filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllPlayers = async (req, res) => {
  try {
    // Extract query parameters for filtering with larger page size
    const { 
      position, 
      team, 
      search, 
      availability = 'available', // Default to available players
      fantasy_team, // Add fantasy team filter
      page = 1, 
      limit = 50, // Set to 50 players per page to ensure pagination shows
      sortBy = 'last_name',
      sortDir = 'ASC'
    } = req.query;
    
    
    // Calculate offset
    const offset = (page - 1) * limit;
    
    // Prepare filter options with pagination
    const options = {
      position: position || null,
      team: team || null, // Keep as-is, including "null" string
      nameSearch: search || null,
      availability: availability || 'available',
      fantasy_team: fantasy_team || null, // Add fantasy team filter
      limit,
      offset,
      sortBy,
      sortDir
    };
    
    // Get players and total count for pagination
    const [players, totalCount] = await Promise.all([
      Player.getAll(options),
      Player.count(options)
    ]);
    
    // Get NFL teams and fantasy teams for the filter dropdowns
    const [teams, fantasyTeams] = await Promise.all([
      NFLTeam.getAll(),
      FantasyTeam.getAll()
    ]);
    
    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    
    // For API requests or AJAX requests, return JSON
    if (req.xhr || req.path.startsWith('/api/') || req.query.ajax === 'true') {
      return res.json({
        players,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    }
    
    // For web requests, render the view
    res.render('players/index', {
      title: 'NFL Players',
      players,
      teams,
      fantasyTeams,
      filters: {
        position,
        team,
        search,
        availability,
        fantasy_team
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      user: req.session.user
    });
  } catch (error) {
    console.error('Error getting players:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error retrieving players' });
    }
    
    // For web requests, render with error
    req.flash('error_msg', 'Error retrieving players');
    res.redirect('/dashboard');
  }
};

/**
 * Get a single player by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPlayerById = async (req, res) => {
  try {
    const playerId = req.params.id;
    const player = await Player.findById(playerId);
    
    if (!player) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ message: 'Player not found' });
      }
      
      // For web requests, redirect with error
      req.flash('error_msg', 'Player not found');
      return res.redirect('/players');
    }
    
    // For API requests, return JSON
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ player });
    }
    
    // For web requests, render the view
    res.render('players/detail', {
      title: player.display_name,
      player,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error getting player:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error retrieving player' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error retrieving player');
    res.redirect('/players');
  }
};

/**
 * Show the create player form
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.showCreateForm = async (req, res) => {
  try {
    // Get NFL teams for the dropdown
    const teams = await NFLTeam.getAll();
    
    res.render('players/create', {
      title: 'Create Player',
      teams,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error showing create form:', error.message);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/players');
  }
};

/**
 * Create a new player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.createPlayer = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // For API requests, return validation errors
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      // For web requests, redirect back with errors
      const teams = await NFLTeam.getAll();
      return res.render('players/create', {
        title: 'Create Player',
        errors: errors.array(),
        formData: req.body,
        teams,
        user: req.session.user
      });
    }
    
    // Create the player
    const playerData = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      displayName: req.body.displayName,
      nflTeamId: req.body.nflTeamId || null,
      position: req.body.position,
      jerseyNumber: req.body.jerseyNumber || null,
      status: req.body.status || 'Active',
      rookieYear: req.body.rookieYear || new Date().getFullYear(),
      isRookie: req.body.isRookie === 'on' || req.body.isRookie === true,
      userId: req.session.user ? req.session.user.id : null
    };
    
    const playerId = await Player.create(playerData);
    
    // For API requests, return success
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(201).json({ 
        message: 'Player created successfully',
        playerId
      });
    }
    
    // For web requests, redirect to the player detail page
    req.flash('success_msg', 'Player created successfully');
    res.redirect(`/players/${playerId}`);
  } catch (error) {
    console.error('Error creating player:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error creating player' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error creating player');
    res.redirect('/players');
  }
};

/**
 * Show the edit player form
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.showEditForm = async (req, res) => {
  try {
    const playerId = req.params.id;
    const [player, teams] = await Promise.all([
      Player.findById(playerId),
      NFLTeam.getAll()
    ]);
    
    if (!player) {
      req.flash('error_msg', 'Player not found');
      return res.redirect('/players');
    }
    
    res.render('players/edit', {
      title: `Edit ${player.display_name}`,
      player,
      teams,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error showing edit form:', error.message);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/players');
  }
};

/**
 * Update a player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePlayer = async (req, res) => {
  try {
    const playerId = req.params.id;
    
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // For API requests, return validation errors
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      // For web requests, redirect back with errors
      const [player, teams] = await Promise.all([
        Player.findById(playerId),
        NFLTeam.getAll()
      ]);
      
      return res.render('players/edit', {
        title: `Edit ${player.display_name}`,
        player,
        teams,
        errors: errors.array(),
        formData: req.body,
        user: req.session.user
      });
    }
    
    // Update the player
    const playerData = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      displayName: req.body.displayName,
      nflTeamId: req.body.nflTeamId || null,
      position: req.body.position,
      jerseyNumber: req.body.jerseyNumber || null,
      status: req.body.status || 'Active',
      rookieYear: req.body.rookieYear || null,
      isRookie: req.body.isRookie === 'on' || req.body.isRookie === true
    };
    
    const userId = req.session.user ? req.session.user.id : null;
    const success = await Player.update(playerId, playerData, userId);
    
    // For API requests, return result
    if (req.xhr || req.path.startsWith('/api/')) {
      if (success) {
        return res.json({ message: 'Player updated successfully' });
      } else {
        return res.status(404).json({ message: 'Player not found or not updated' });
      }
    }
    
    // For web requests, redirect appropriately
    if (success) {
      req.flash('success_msg', 'Player updated successfully');
      res.redirect(`/players/${playerId}`);
    } else {
      req.flash('error_msg', 'Player not found or not updated');
      res.redirect('/players');
    }
  } catch (error) {
    console.error('Error updating player:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error updating player' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error updating player');
    res.redirect('/players');
  }
};

/**
 * Delete a player
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deletePlayer = async (req, res) => {
  try {
    const playerId = req.params.id;
    const userId = req.session.user ? req.session.user.id : null;
    
    const success = await Player.delete(playerId, userId);
    
    // For API requests, return result
    if (req.xhr || req.path.startsWith('/api/')) {
      if (success) {
        return res.json({ message: 'Player deleted successfully' });
      } else {
        return res.status(404).json({ message: 'Player not found or not deleted' });
      }
    }
    
    // For web requests, redirect appropriately
    if (success) {
      req.flash('success_msg', 'Player deleted successfully');
    } else {
      req.flash('error_msg', 'Player not found or not deleted');
    }
    
    res.redirect('/players');
  } catch (error) {
    console.error('Error deleting player:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error deleting player' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error deleting player');
    res.redirect('/players');
  }
};

/**
 * Get available players (not on any fantasy team)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAvailablePlayers = async (req, res) => {
  try {
    // Extract query parameters for filtering and pagination
    const { 
      position, 
      team, 
      search, 
      rookie,
      page = 1, 
      limit = 50,
      sortBy = 'last_name',
      sortDir = 'ASC'
    } = req.query;
    
    // Calculate offset
    const offset = (page - 1) * limit;
    
    // Prepare filter options
    const options = {
      position: position || null,
      team: team || null,
      nameSearch: search || null,
      isRookie: rookie === 'true' ? true : (rookie === 'false' ? false : null),
      limit,
      offset,
      sortBy,
      sortDir
    };
    
    // Get available players
    const players = await Player.getAvailable(options);
    
    // For API requests, return JSON
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ players });
    }
    
    // Get NFL teams for the filter dropdown
    const teams = await NFLTeam.getAll();
    
    // For web requests, render the view
    res.render('players/index', {
      title: 'Available Players',
      players,
      teams,
      activePage: 'players',
      filters: {
        position,
        team,
        search,
        rookie
      },
      pagination: {
        currentPage: parseInt(page),
        // We would need to implement a count method for available players
        // for accurate pagination info
        hasNext: players.length === parseInt(limit),
        hasPrev: page > 1
      },
      user: req.session.user
    });
  } catch (error) {
    console.error('Error getting available players:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error retrieving available players' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error retrieving available players');
    res.redirect('/dashboard');
  }
};