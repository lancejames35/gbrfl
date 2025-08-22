/**
 * NFL Player Model
 * Handles all NFL player-related database operations
 */

const db = require('../config/database');

class Player {
  /**
   * Find a player by ID
   * @param {number} playerId - The player's ID
   * @returns {Promise<Object|null>} - The player object or null if not found
   */
  static async findById(playerId) {
    try {
      const players = await db.query(
        `SELECT p.*, t.team_name, t.team_code 
         FROM nfl_players p
         LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
         WHERE p.player_id = ?`,
        [playerId]
      );
      return players.length ? players[0] : null;
    } catch (error) {
      console.error('Error finding player by ID:', error.message);
      throw error;
    }
  }

  /**
   * Find players by name
   * @param {string} name - Name to search for
   * @returns {Promise<Array>} - Array of matching player objects
   */
  static async findByName(name) {
    try {
      const players = await db.query(
        `SELECT p.*, t.team_name, t.team_code 
         FROM nfl_players p
         LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
         WHERE p.first_name LIKE ? OR p.last_name LIKE ? OR p.display_name LIKE ?`,
        [`%${name}%`, `%${name}%`, `%${name}%`]
      );
      return players;
    } catch (error) {
      console.error('Error finding players by name:', error.message);
      throw error;
    }
  }

/**
 * Get all players with optional filtering
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} - Array of player objects
 */
static async getAll(options = {}) {
  try {
    const {
      position = null,
      team = null,
      nameSearch = null,
      availability = 'available',
      limit = 50,
      offset = 0,
      sortBy = 'last_name',
      sortDir = 'ASC'
    } = options;

    // Build the query with fantasy team information
    let query = `
      SELECT p.*, t.team_name, t.team_code, 
             ft.team_id as fantasy_team_id, ft.team_name as fantasy_team_name,
             CASE WHEN ftp.player_id IS NOT NULL THEN 1 ELSE 0 END as is_rostered
      FROM nfl_players p
      LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
      LEFT JOIN fantasy_team_players ftp ON p.player_id = ftp.player_id
      LEFT JOIN fantasy_teams ft ON ftp.fantasy_team_id = ft.team_id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add availability filter
    if (availability === 'available') {
      query += ` AND ftp.player_id IS NULL`;
    } else if (availability === 'taken') {
      query += ` AND ftp.player_id IS NOT NULL`;
    }
    // For 'all', we don't add any filter
    
    // Add other filters
    if (position) {
      query += ' AND p.position = ?';
      params.push(position);
    }
    
    if (team) {
      if (team === 'null') {
        query += ' AND t.team_code = ?';
        params.push('FA');
      } else {
        query += ' AND p.nfl_team_id = ?';
        params.push(team);
      }
    }
    
    if (nameSearch) {
      query += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.display_name LIKE ?)';
      const searchTerm = `%${nameSearch}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    // Add sorting
    const allowedSortFields = ['first_name', 'last_name', 'display_name', 'position'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'last_name';
    const direction = sortDir === 'DESC' ? 'DESC' : 'ASC';
    
    query += ` ORDER BY p.${sortField} ${direction}`;
    
    // Add pagination
    query += ` LIMIT ${Number(limit)} OFFSET ${Number(offset || 0)}`;
    
    const players = await db.query(query, params);
    return players;
  } catch (error) {
    console.error('Error getting players:', error.message);
    throw error;
  }
}

  /**
   * Count players with optional filtering
   * @param {Object} options - Filter options
   * @returns {Promise<number>} - Count of matching players
   */
  static async count(options = {}) {
    try {
      const {
        position = null,
        team = null,
        nameSearch = null,
        availability = 'available'
      } = options;
  
      // Build the query
      let query = `
        SELECT COUNT(*) as count 
        FROM nfl_players p
        LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
        LEFT JOIN fantasy_team_players ftp ON p.player_id = ftp.player_id
        WHERE 1=1
      `;
      
      const params = [];
      
      // Add availability filter
      if (availability === 'available') {
        query += ` AND ftp.player_id IS NULL`;
      } else if (availability === 'taken') {
        query += ` AND ftp.player_id IS NOT NULL`;
      }
      
      // Add other filters
      if (position) {
        query += ' AND p.position = ?';
        params.push(position);
      }
      
      if (team) {
        if (team === 'null') {
          query += ' AND t.team_code = ?';
          params.push('FA');
        } else {
          query += ' AND p.nfl_team_id = ?';
          params.push(team);
        }
      }
      
      if (nameSearch) {
        query += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.display_name LIKE ?)';
        const searchTerm = `%${nameSearch}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      const result = await db.query(query, params);
      return result[0].count;
    } catch (error) {
      console.error('Error counting players:', error.message);
      throw error;
    }
  }

/**
 * Create a new player
 * @param {Object} playerData - Player data
 * @returns {Promise<number>} - The ID of the newly created player
 */
static async create(playerData) {
  try {
    // Determine display name if not provided
    const displayName = playerData.displayName || 
      `${playerData.firstName} ${playerData.lastName}`;
    
    const result = await db.query(
      `INSERT INTO nfl_players 
       (first_name, last_name, display_name, nfl_team_id, position) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        playerData.firstName,
        playerData.lastName,
        displayName,
        playerData.nflTeamId || null,
        playerData.position
      ]
    );
    
    // Log activity
    if (result.insertId) {
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          playerData.userId || null,
          'PLAYER_CREATED',
          'NFL_PLAYER',
          result.insertId,
          `New player added: ${displayName}`
        ]
      );
    }
    
    return result.insertId;
  } catch (error) {
    console.error('Error creating player:', error.message);
    throw error;
  }
}

/**
 * Update a player
 * @param {number} playerId - The ID of the player to update
 * @param {Object} playerData - Updated player data
 * @param {number} userId - ID of the user making the update
 * @returns {Promise<boolean>} - True if successful
 */
static async update(playerId, playerData, userId) {
  try {
    // Start building the query
    let query = 'UPDATE nfl_players SET ';
    const params = [];
    
    // Add fields to update
    if (playerData.firstName) {
      query += 'first_name = ?, ';
      params.push(playerData.firstName);
    }
    
    if (playerData.lastName) {
      query += 'last_name = ?, ';
      params.push(playerData.lastName);
    }
    
    if (playerData.displayName) {
      query += 'display_name = ?, ';
      params.push(playerData.displayName);
    }
    
    if (playerData.nflTeamId !== undefined) {
      query += 'nfl_team_id = ?, ';
      params.push(playerData.nflTeamId);
    }
    
    if (playerData.position) {
      query += 'position = ?, ';
      params.push(playerData.position);
    }
    
    // Remove trailing comma and space
    query = query.slice(0, -2);
    
    // Add WHERE clause
    query += ' WHERE player_id = ?';
    params.push(playerId);
    
    // Execute query
    const result = await db.query(query, params);
    
    // Log activity
    if (result.affectedRows > 0) {
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          userId || null,
          'PLAYER_UPDATED',
          'NFL_PLAYER',
          playerId,
          `Player updated: ID ${playerId}`
        ]
      );
    }
    
    return result.affectedRows > 0;
  } catch (error) {
    console.error('Error updating player:', error.message);
    throw error;
  }
}

  /**
   * Delete a player
   * @param {number} playerId - The ID of the player to delete
   * @param {number} userId - ID of the user making the deletion
   * @returns {Promise<boolean>} - True if successful
   */
  static async delete(playerId, userId) {
    try {
      // Get player info before deleting
      const player = await this.findById(playerId);
      
      if (!player) {
        return false;
      }
      
      // Execute query
      const result = await db.query('DELETE FROM nfl_players WHERE player_id = ?', [playerId]);
      
      // Log activity
      if (result.affectedRows > 0) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [
            userId || null,
            'PLAYER_DELETED',
            'NFL_PLAYER',
            playerId,
            `Player deleted: ${player.display_name}`
          ]
        );
      }
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting player:', error.message);
      throw error;
    }
  }

  /**
   * Get available players (not on any fantasy team)
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} - Array of available player objects
   */
  static async getAvailable(options = {}) {
    try {
      const {
        position = null,
        team = null,
        nameSearch = null,
        isRookie = null,
        limit = 50,
        offset = 0,
        sortBy = 'last_name',
        sortDir = 'ASC'
      } = options;

      // Build the query
      let query = `
        SELECT p.*, t.team_name, t.team_code 
        FROM nfl_players p
        LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
        WHERE p.player_id NOT IN (
          SELECT player_id FROM fantasy_team_players
        )
      `;
      
      const params = [];
      
      // Add filters
      if (position) {
        query += ' AND p.position = ?';
        params.push(position);
      }
      
      if (team) {
        query += ' AND p.nfl_team_id = ?';
        params.push(team);
      }
      
      if (nameSearch) {
        query += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.display_name LIKE ?)';
        const searchTerm = `%${nameSearch}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      // Add sorting
      const allowedSortFields = ['first_name', 'last_name', 'display_name', 'position'];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'last_name';
      const direction = sortDir === 'DESC' ? 'DESC' : 'ASC';
      
      query += ` ORDER BY p.${sortField} ${direction}`;
      
      // Add pagination
      query += ' LIMIT ' + Number(limit) + ' OFFSET ' + Number(offset);
      
      const players = await db.query(query, params);
      return players;
    } catch (error) {
      console.error('Error getting available players:', error.message);
      throw error;
    }
  }
}

module.exports = Player;