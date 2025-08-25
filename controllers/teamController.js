/**
 * Team Controller
 * Handles fantasy team-related functionality
 */

const FantasyTeam = require('../models/FantasyTeam');
const { validationResult } = require('express-validator');

/**
 * Get all teams
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllTeams = async (req, res) => {
  try {
    const teams = await FantasyTeam.getAll();
    
    // For API requests, return JSON
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ teams });
    }
    
    // For web requests, render the view
    res.render('teams/index', {
      title: 'Fantasy Teams',
      teams,
      user: req.session.user,
      activePage: 'teams'
    });
  } catch (error) {
    console.error('Error getting teams:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error retrieving teams' });
    }
    
    // For web requests, render with error
    req.flash('error_msg', 'Error retrieving teams');
    res.redirect('/dashboard');
  }
};

/**
 * Get the user's teams
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getMyTeams = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const teams = await FantasyTeam.findByUserId(userId);
    
    // For API requests, return JSON
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ teams });
    }
    
    // For web requests, render the view
    res.render('teams/my-teams', {
      title: 'My Teams',
      teams,
      user: req.session.user,
      activePage: 'teams'
    });
  } catch (error) {
    console.error('Error getting user teams:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error retrieving your teams' });
    }
    
    // For web requests, render with error
    req.flash('error_msg', 'Error retrieving your teams');
    res.redirect('/dashboard');
  }
};

/**
 * Get a specific team by ID with dropdown selector for all teams
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTeamById = async (req, res) => {
  try {
    const teamId = req.params.id;
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ message: 'Team not found' });
      }
      
      // For web requests, render with error
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Get players on the team
    const players = await FantasyTeam.getPlayers(teamId);
    
    // Get all teams for the dropdown selector
    let allTeams = await FantasyTeam.getAll();
    
    // Determine if the current user can edit this team
    const canEdit = (parseInt(req.session.user.id) === parseInt(team.user_id));
    
    // Sort teams: user's teams first, then alphabetical
    allTeams = allTeams.sort((a, b) => {
      // User's teams come first
      if (a.user_id === req.session.user.id && b.user_id !== req.session.user.id) return -1;
      if (a.user_id !== req.session.user.id && b.user_id === req.session.user.id) return 1;
      
      // Alphabetical sort for the rest
      return a.team_name.localeCompare(b.team_name);
    });
    
    // For API requests, return JSON
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ 
        team,
        players
      });
    }
    
    // Get keeper information for the view
    const keeperCount = await FantasyTeam.getKeeperCount(teamId);
    const keeperLimit = await FantasyTeam.getKeeperLimit(teamId);
    const deadlinePassed = await FantasyTeam.isKeeperDeadlinePassed();
    const leagueSettings = await FantasyTeam.getLeagueSettings();

    // For web requests, render the view
    res.render('teams/detail', {
      title: team.team_name,
      team,
      players,
      allTeams, // Pass all teams for the dropdown
      canEdit,  // Pass this flag to control editing permissions
      activePage: 'teams',
      keeperCount,
      keeperLimit,
      deadlinePassed,
      leagueSettings,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error getting team:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error retrieving team' });
    }
    
    // For web requests, render with error
    req.flash('error_msg', 'Error retrieving team');
    res.redirect('/teams');
  }
};

/**
 * Show the create team form
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.showCreateForm = async (req, res) => {
  try {
    res.render('teams/create', {
      title: 'Create Team',
      user: req.session.user,
      activePage: 'teams'
    });
  } catch (error) {
    console.error('Error showing create form:', error.message);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/teams');
  }
};

/**
 * Create a new team
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.createTeam = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // For API requests, return validation errors
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      // For web requests, redirect back with errors
      return res.render('teams/create', {
        title: 'Create Team',
        errors: errors.array(),
        team: req.body,
        user: req.session.user,
        activePage: 'teams'
      });
    }
    
    // Create the team
    const teamData = {
      teamName: req.body.teamName,
      userId: req.session.user.id
    };
    
    const teamId = await FantasyTeam.create(teamData);
    
    // For API requests, return success
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(201).json({ 
        message: 'Team created successfully',
        teamId
      });
    }
    
    // For web requests, redirect to the team detail page
    req.flash('success_msg', 'Team created successfully');
    res.redirect(`/teams/${teamId}`);
  } catch (error) {
    console.error('Error creating team:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error creating team' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error creating team');
    res.redirect('/teams');
  }
};

/**
 * Add a player to a team's roster
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.addPlayerToTeam = async (req, res) => {
  try {
    const { teamId, playerId, acquisitionType, isKeeper } = req.body;
    
    // Check if user owns the team or is admin
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'Team not found' });
      }
      
      // For web requests, render with error
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Validate ownership
    if (team.user_id !== req.session.user.id && !req.session.user.isAdmin) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, message: 'You do not have permission to modify this team' });
      }
      
      // For web requests, render with error
      req.flash('error_msg', 'You do not have permission to modify this team');
      return res.redirect(`/teams/${teamId}`);
    }
    
    // If adding as keeper, check if keeper slots are available
    if (isKeeper) {
      // Check if keeper deadline has passed
      const deadlinePassed = await FantasyTeam.isKeeperDeadlinePassed();
      if (deadlinePassed) {
        // For API requests, return JSON error
        if (req.xhr || req.path.startsWith('/api/')) {
          return res.status(400).json({ success: false, message: 'Keeper deadline has passed' });
        }
        
        // For web requests, render with error
        req.flash('error_msg', 'Keeper deadline has passed');
        return res.redirect(`/teams/${teamId}`);
      }
      
      const keeperCount = await FantasyTeam.getKeeperCount(teamId);
      const maxKeepers = await FantasyTeam.getKeeperLimit(teamId);
      
      if (keeperCount >= maxKeepers) {
        // For API requests, return JSON error
        if (req.xhr || req.path.startsWith('/api/')) {
          return res.status(400).json({ success: false, message: 'Maximum keeper slots already used' });
        }
        
        // For web requests, render with error
        req.flash('error_msg', 'Maximum keeper slots already used');
        return res.redirect(`/teams/${teamId}`);
      }
    }
    
    // Add player to team
    await FantasyTeam.addPlayerToRoster({
      teamId,
      playerId,
      acquisitionType: acquisitionType || 'Free Agent',
      isKeeper: isKeeper ? 1 : 0,
      userId: req.session.user.id
    });
    
    // For API requests, return JSON success
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ success: true, message: 'Player added to roster' });
    }
    
    // For web requests, redirect with success message
    req.flash('success_msg', 'Player added to roster');
    res.redirect(`/teams/${teamId}`);
  } catch (error) {
    console.error('Error adding player to team:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'Error adding player to roster' });
    }
    
    // For web requests, render with error
    req.flash('error_msg', 'Error adding player to roster');
    res.redirect(`/teams/${req.body.teamId}`);
  }
};

/**
 * Remove a player from a team's roster
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.removePlayerFromTeam = async (req, res) => {
  try {
    const { teamId, playerId } = req.body;
    
    // Check if user owns the team or is admin
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'Team not found' });
      }
      
      // For web requests, render with error
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Validate ownership
    if (team.user_id !== req.session.user.id && !req.session.user.isAdmin) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, message: 'You do not have permission to modify this team' });
      }
      
      // For web requests, render with error
      req.flash('error_msg', 'You do not have permission to modify this team');
      return res.redirect(`/teams/${teamId}`);
    }
    
    // Remove player from team
    await FantasyTeam.removePlayerFromRoster(teamId, playerId, req.session.user.id);
    
    // For API requests, return JSON success
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.json({ success: true, message: 'Player removed from roster' });
    }
    
    // For web requests, redirect with success message
    req.flash('success_msg', 'Player removed from roster');
    res.redirect(`/teams/${teamId}`);
  } catch (error) {
    console.error('Error removing player from team:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'Error removing player from roster' });
    }
    
    // For web requests, render with error
    req.flash('error_msg', 'Error removing player from roster');
    res.redirect(`/teams/${req.body.teamId}`);
  }
};

/**
 * Toggle a player's keeper status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.toggleKeeperStatus = async (req, res) => {
  try {
    const { teamId, playerId, isKeeper } = req.body;
    
    // Check if user owns the team or is admin
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    // Validate ownership
    if (team.user_id !== req.session.user.id && !req.session.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'You do not have permission to modify this team' });
    }
    
    // Check if keeper deadline has passed (for any keeper changes)
    const deadlinePassed = await FantasyTeam.isKeeperDeadlinePassed();
    if (deadlinePassed) {
      return res.status(400).json({ success: false, message: 'Keeper deadline has passed' });
    }
    
    // If setting as keeper, check if keeper slots are available
    if (isKeeper) {
      const keeperCount = await FantasyTeam.getKeeperCount(teamId);
      const maxKeepers = await FantasyTeam.getKeeperLimit(teamId);
      
      if (keeperCount >= maxKeepers) {
        return res.status(400).json({ success: false, message: 'Maximum keeper slots already used' });
      }
    }
    
    // Toggle keeper status
    await FantasyTeam.updateKeeperStatus(teamId, playerId, isKeeper, req.session.user.id);
    
    return res.json({ 
      success: true, 
      message: isKeeper ? 'Player marked as keeper' : 'Player removed from keepers' 
    });
  } catch (error) {
    console.error('Error toggling keeper status:', error.message);
    return res.status(500).json({ success: false, message: 'Error updating keeper status' });
  }
};

/**
 * Update multiple keepers at once
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateKeepers = async (req, res) => {
  try {
    const teamId = req.params.id;
    const keeperIds = req.body.keepers || [];
    
    // Check if user owns the team or is admin
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Validate ownership
    if (team.user_id !== req.session.user.id && !req.session.user.isAdmin) {
      req.flash('error_msg', 'You do not have permission to modify this team');
      return res.redirect(`/teams/${teamId}`);
    }
    
    // Check if keeper deadline has passed
    const deadlinePassed = await FantasyTeam.isKeeperDeadlinePassed();
    if (deadlinePassed) {
      req.flash('error_msg', 'Keeper deadline has passed');
      return res.redirect(`/teams/${teamId}`);
    }

    // Check if keeper count exceeds maximum
    const maxKeepers = await FantasyTeam.getKeeperLimit(teamId);
    if (keeperIds.length > maxKeepers) {
      req.flash('error_msg', `You can only select up to ${maxKeepers} keepers`);
      return res.redirect(`/teams/${teamId}`);
    }
    
    // Update all keeper statuses
    await FantasyTeam.updateAllKeepers(teamId, keeperIds, req.session.user.id);
    
    req.flash('success_msg', 'Keeper selections updated');
    res.redirect(`/teams/${teamId}`);
  } catch (error) {
    console.error('Error updating keepers:', error.message);
    req.flash('error_msg', 'Error updating keeper selections');
    res.redirect(`/teams/${req.params.id}`);
  }
};

/**
 * Get keeper management page for a specific team
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTeamKeepers = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Check if user owns the team or is admin
    const canEdit = (parseInt(req.session.user.id) === parseInt(team.user_id)) || req.session.user.isAdmin;
    
    if (!canEdit) {
      req.flash('error_msg', 'You do not have permission to manage keepers for this team');
      return res.redirect(`/teams/${teamId}`);
    }
    
    // Get players on the team
    const players = await FantasyTeam.getPlayers(teamId);
    
    // Get all teams for the dropdown selector
    let allTeams = await FantasyTeam.getAll();
    
    // Sort teams: user's teams first, then alphabetical
    allTeams = allTeams.sort((a, b) => {
      if (a.user_id === req.session.user.id && b.user_id !== req.session.user.id) return -1;
      if (a.user_id !== req.session.user.id && b.user_id === req.session.user.id) return 1;
      return a.team_name.localeCompare(b.team_name);
    });
    
    // Get keeper information
    const keeperCount = await FantasyTeam.getKeeperCount(teamId);
    const keeperLimit = await FantasyTeam.getKeeperLimit(teamId);
    const deadlinePassed = await FantasyTeam.isKeeperDeadlinePassed();
    const leagueSettings = await FantasyTeam.getLeagueSettings();

    res.render('keepers/index', {
      title: `Keeper Management - ${team.team_name}`,
      team,
      players,
      allTeams,
      canEdit,
      activePage: 'keepers',
      keeperCount,
      keeperLimit,
      deadlinePassed,
      leagueSettings,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error getting team keepers:', error.message);
    req.flash('error_msg', 'Error retrieving keeper information');
    res.redirect('/teams');
  }
};

/**
 * Update keepers from keeper page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateKeepersFromKeeperPage = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const keeperIds = req.body.keepers || [];
    
    // Check if user owns the team or is admin
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      req.flash('error_msg', 'Team not found');
      return res.redirect('/keepers');
    }
    
    // Validate ownership
    if (team.user_id !== req.session.user.id && !req.session.user.isAdmin) {
      req.flash('error_msg', 'You do not have permission to modify this team');
      return res.redirect(`/keepers/${teamId}`);
    }
    
    // Check if keeper deadline has passed
    const deadlinePassed = await FantasyTeam.isKeeperDeadlinePassed();
    if (deadlinePassed) {
      req.flash('error_msg', 'Keeper deadline has passed');
      return res.redirect(`/keepers/${teamId}`);
    }

    // Check if keeper count exceeds maximum
    const maxKeepers = await FantasyTeam.getKeeperLimit(teamId);
    if (keeperIds.length > maxKeepers) {
      req.flash('error_msg', `You can only select up to ${maxKeepers} keepers`);
      return res.redirect(`/keepers/${teamId}`);
    }
    
    // Update all keeper statuses
    await FantasyTeam.updateAllKeepers(teamId, keeperIds, req.session.user.id);
    
    req.flash('success_msg', 'Keeper selections updated');
    res.redirect(`/keepers/${teamId}`);
  } catch (error) {
    console.error('Error updating keepers:', error.message);
    req.flash('error_msg', 'Error updating keeper selections');
    res.redirect(`/keepers/${req.params.teamId}`);
  }
};

/**
 * Get available players (not on any roster)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAvailablePlayers = async (req, res) => {
  try {
    const players = await FantasyTeam.getAvailablePlayers();
    
    res.json({ success: true, players });
  } catch (error) {
    console.error('Error getting available players:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving available players' });
  }
};

/**
 * Get current user's roster
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getMyRoster = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Get user's team
    const userTeams = await FantasyTeam.findByUserId(userId);
    
    if (userTeams.length === 0) {
      return res.json({ success: false, message: 'You do not have a fantasy team' });
    }
    
    // Get players on the user's team
    const players = await FantasyTeam.getPlayers(userTeams[0].team_id);
    
    res.json({ success: true, players });
  } catch (error) {
    console.error('Error getting user roster:', error.message);
    res.status(500).json({ success: false, message: 'Error retrieving your roster' });
  }
};

/**
 * Redirect to the user's team roster or team selection page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.redirectToUserTeam = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Get all teams owned by the user
    const userTeams = await FantasyTeam.findByUserId(userId);
    
    if (userTeams.length === 0) {
      // If user has no teams, redirect to create team page
      return res.redirect('/teams/create');
    } else if (userTeams.length === 1) {
      // If user has exactly one team, redirect directly to that team
      return res.redirect(`/teams/${userTeams[0].team_id}`);
    } else {
      // If user has multiple teams, go to my-teams page to choose
      // Later we could change this to go to the first team instead
      return res.redirect('/teams/my-teams');
    }
    
  } catch (error) {
    console.error('Error in redirectToUserTeam:', error.message);
    req.flash('error_msg', 'An error occurred while retrieving your teams');
    res.redirect('/dashboard');
  }
};

/**
 * Show the edit team form
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.showEditForm = async (req, res) => {
  try {
    const teamId = req.params.id;
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Check if user can edit this team
    const canEdit = (req.session.user.id === team.user_id) || req.session.user.isAdmin;
    
    if (!canEdit) {
      req.flash('error_msg', 'You do not have permission to edit this team');
      return res.redirect(`/teams/${teamId}`);
    }
    
    res.render('teams/edit', {
      title: `Edit ${team.team_name}`,
      team,
      user: req.session.user,
      activePage: 'teams'
    });
  } catch (error) {
    console.error('Error showing edit form:', error.message);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/teams');
  }
};

/**
 * Update a team
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // For API requests, return validation errors
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      // For web requests, redirect back with errors
      const team = await FantasyTeam.findById(teamId);
      return res.render('teams/edit', {
        title: `Edit ${team.team_name}`,
        team,
        errors: errors.array(),
        formData: req.body,
        user: req.session.user,
        activePage: 'teams'
      });
    }
    
    const team = await FantasyTeam.findById(teamId);
    
    if (!team) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ message: 'Team not found' });
      }
      
      // For web requests, redirect with error
      req.flash('error_msg', 'Team not found');
      return res.redirect('/teams');
    }
    
    // Check if user can edit this team
    const canEdit = (req.session.user.id === team.user_id) || req.session.user.isAdmin;
    
    if (!canEdit) {
      // For API requests, return JSON error
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ message: 'You do not have permission to edit this team' });
      }
      
      // For web requests, redirect with error
      req.flash('error_msg', 'You do not have permission to edit this team');
      return res.redirect(`/teams/${teamId}`);
    }
    
    // Update the team using the model method (which has its own permission check)
    const teamData = {
      teamName: req.body.teamName
    };
    
    const success = await FantasyTeam.update(teamId, teamData, req.session.user.id);
    
    // For API requests, return result
    if (req.xhr || req.path.startsWith('/api/')) {
      if (success) {
        return res.json({ message: 'Team updated successfully' });
      } else {
        return res.status(404).json({ message: 'Team not found or not updated' });
      }
    }
    
    // For web requests, redirect appropriately
    if (success) {
      req.flash('success_msg', 'Team updated successfully');
      res.redirect(`/teams/${teamId}`);
    } else {
      req.flash('error_msg', 'Team not found or not updated');
      res.redirect('/teams');
    }
  } catch (error) {
    console.error('Error updating team:', error.message);
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ message: 'Error updating team' });
    }
    
    // For web requests, redirect with error
    req.flash('error_msg', 'Error updating team');
    res.redirect('/teams');
  }
};