/**
 * Fantasy Team Model
 * Handles all fantasy team-related database operations
 */

const db = require('../config/database');

class FantasyTeam {
  /**
   * Find a team by ID
   * @param {number} teamId - The team's ID
   * @returns {Promise<Object|null>} - The team object or null if not found
   */
  static async findById(teamId) {
    try {
      const teams = await db.query(
        `SELECT t.*, u.username as owner_username, u.member_since
         FROM fantasy_teams t
         JOIN users u ON t.user_id = u.user_id
         WHERE t.team_id = ?`,
        [teamId]
      );
      return teams.length ? teams[0] : null;
    } catch (error) {
      console.error('Error finding fantasy team by ID:', error.message);
      throw error;
    }
  }

  /**
   * Find teams by user ID
   * @param {number} userId - The user's ID
   * @returns {Promise<Array>} - Array of team objects
   */
  static async findByUserId(userId) {
    try {
      const teams = await db.query(
        'SELECT * FROM fantasy_teams WHERE user_id = ?',
        [userId]
      );
      return teams;
    } catch (error) {
      console.error('Error finding fantasy teams by user ID:', error.message);
      throw error;
    }
  }

  /**
   * Get all fantasy teams
   * @returns {Promise<Array>} - Array of team objects
   */
  static async getAll() {
    try {
      const teams = await db.query(
        `SELECT t.*, u.username as owner_username
         FROM fantasy_teams t
         JOIN users u ON t.user_id = u.user_id
         ORDER BY t.team_name`
      );
      return teams;
    } catch (error) {
      console.error('Error getting all fantasy teams:', error.message);
      throw error;
    }
  }

/**
 * Get players on a fantasy team
 * @param {number} teamId - The fantasy team ID
 * @returns {Promise<Array>} - Array of player objects
 */
static async getPlayers(teamId) {
    try {
      const players = await db.query(
        `SELECT p.*, ftp.is_keeper, ftp.acquisition_type, ftp.acquisition_date, t.team_name, t.team_code
         FROM fantasy_team_players ftp
         JOIN nfl_players p ON ftp.player_id = p.player_id
         LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
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
         p.last_name, p.first_name`,
        [teamId]
      );
      return players;
    } catch (error) {
      console.error('Error getting players for fantasy team:', error.message);
      throw error;
    }
  }

  /**
   * Create a new fantasy team
   * @param {Object} teamData - Team data
   * @returns {Promise<number>} - The ID of the newly created team
   */
  static async create(teamData) {
    try {
      const result = await db.query(
        'INSERT INTO fantasy_teams (team_name, user_id) VALUES (?, ?)',
        [teamData.teamName, teamData.userId]
      );
      
      // Log activity
      if (result.insertId) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [
            teamData.userId,
            'TEAM_CREATED',
            'FANTASY_TEAM',
            result.insertId,
            `New fantasy team created: ${teamData.teamName}`
          ]
        );
      }
      
      return result.insertId;
    } catch (error) {
      console.error('Error creating fantasy team:', error.message);
      throw error;
    }
  }

  /**
   * Update a fantasy team
   * @param {number} teamId - The ID of the team to update
   * @param {Object} teamData - Updated team data
   * @param {number} userId - ID of the user making the update
   * @returns {Promise<boolean>} - True if successful
   */
  static async update(teamId, teamData, userId) {
    try {
      // Get team info for validation
      const team = await this.findById(teamId);
      
      if (!team) {
        return false;
      }
      
      // Validate ownership unless admin
      const isOwner = team.user_id === userId;
      const isAdmin = userId && await this.isUserAdmin(userId);
      
      if (!isOwner && !isAdmin) {
        throw new Error('Unauthorized - User does not own this team');
      }
      
      // Execute update
      const result = await db.query(
        'UPDATE fantasy_teams SET team_name = ? WHERE team_id = ?',
        [teamData.teamName, teamId]
      );
      
      // Log activity
      if (result.affectedRows > 0) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [
            userId,
            'TEAM_UPDATED',
            'FANTASY_TEAM',
            teamId,
            `Fantasy team updated: ${teamData.teamName}`
          ]
        );
      }
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating fantasy team:', error.message);
      throw error;
    }
  }

  /**
   * Check if a user is an admin
   * @param {number} userId - User ID to check
   * @returns {Promise<boolean>} - True if the user is an admin
   */
  static async isUserAdmin(userId) {
    try {
      const users = await db.query(
        'SELECT is_admin FROM users WHERE user_id = ?',
        [userId]
      );
      
      return users.length > 0 && users[0].is_admin === 1;
    } catch (error) {
      console.error('Error checking if user is admin:', error.message);
      return false;
    }
  }

  /**
   * Add a player to a team's roster
   * @param {Object} data - Player and team data
   * @param {number} data.teamId - The team's ID
   * @param {number} data.playerId - The player's ID
   * @param {string} data.acquisitionType - How the player was acquired (Draft, Keeper, Trade, Free Agent)
   * @param {boolean} data.isKeeper - Whether the player is a keeper
   * @returns {Promise<Object>} - Result of database operation
   */
  static async addPlayerToRoster(data) {
    try {
      const result = await db.query(
        `INSERT INTO fantasy_team_players 
         (fantasy_team_id, player_id, acquisition_type, is_keeper, acquisition_date) 
         VALUES (?, ?, ?, ?, NOW())`,
        [data.teamId, data.playerId, data.acquisitionType, data.isKeeper]
      );
      
      // Log activity
      if (result.affectedRows > 0) {
        // Get player name for activity log
        const players = await db.query(
          'SELECT display_name FROM nfl_players WHERE player_id = ?',
          [data.playerId]
        );
        
        const playerName = players.length > 0 ? players[0].display_name : `Player #${data.playerId}`;
        
        await db.query(
          `INSERT INTO activity_logs 
           (user_id, action_type, entity_type, entity_id, details) 
           VALUES (?, ?, ?, ?, ?)`,
          [
            data.userId || 0, // If userId not provided, use 0 (system)
            'PLAYER_ADDED',
            'FANTASY_TEAM',
            data.teamId,
            `Added ${playerName} to roster as ${data.acquisitionType}${data.isKeeper ? ' (Keeper)' : ''}`
          ]
        );
      }
      
      return result;
    } catch (error) {
      console.error('Error adding player to roster:', error.message);
      throw error;
    }
  }

  /**
   * Remove a player from a team's roster
   * @param {number} teamId - The team's ID
   * @param {number} playerId - The player's ID
   * @param {number} userId - The user performing the action (for logging)
   * @returns {Promise<Object>} - Result of database operation
   */
  static async removePlayerFromRoster(teamId, playerId, userId = 0) {
    try {
      // Get player info for logging before removal
      const playerQuery = await db.query(
        `SELECT p.display_name, ftp.is_keeper, ftp.acquisition_type
         FROM fantasy_team_players ftp
         JOIN nfl_players p ON ftp.player_id = p.player_id
         WHERE ftp.fantasy_team_id = ? AND ftp.player_id = ?`,
        [teamId, playerId]
      );
      
      const playerInfo = playerQuery.length > 0 ? playerQuery[0] : null;
      
      // Remove player from roster
      const result = await db.query(
        'DELETE FROM fantasy_team_players WHERE fantasy_team_id = ? AND player_id = ?',
        [teamId, playerId]
      );
      
      // Log activity
      if (result.affectedRows > 0 && playerInfo) {
        await db.query(
          `INSERT INTO activity_logs 
           (user_id, action_type, entity_type, entity_id, details) 
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            'PLAYER_REMOVED',
            'FANTASY_TEAM',
            teamId,
            `Removed ${playerInfo.display_name} from roster${playerInfo.is_keeper ? ' (was a keeper)' : ''}`
          ]
        );
      }
      
      return result;
    } catch (error) {
      console.error('Error removing player from roster:', error.message);
      throw error;
    }
  }

  /**
   * Update a player's keeper status
   * @param {number} teamId - The team's ID
   * @param {number} playerId - The player's ID
   * @param {boolean} isKeeper - Whether the player should be a keeper
   * @param {number} userId - The user performing the action (for logging)
   * @returns {Promise<Object>} - Result of database operation
   */
  static async updateKeeperStatus(teamId, playerId, isKeeper, userId = 0) {
    try {
      // Get player name for logging
      const playerQuery = await db.query(
        'SELECT display_name FROM nfl_players WHERE player_id = ?',
        [playerId]
      );
      
      const playerName = playerQuery.length > 0 ? playerQuery[0].display_name : `Player #${playerId}`;
      
      // Update keeper status
      const result = await db.query(
        'UPDATE fantasy_team_players SET is_keeper = ? WHERE fantasy_team_id = ? AND player_id = ?',
        [isKeeper ? 1 : 0, teamId, playerId]
      );
      
      // Log activity
      if (result.affectedRows > 0) {
        await db.query(
          `INSERT INTO activity_logs 
           (user_id, action_type, entity_type, entity_id, details) 
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            isKeeper ? 'KEEPER_ADDED' : 'KEEPER_REMOVED',
            'FANTASY_TEAM',
            teamId,
            isKeeper ? `${playerName} marked as keeper` : `${playerName} removed from keepers`
          ]
        );
      }
      
      return result;
    } catch (error) {
      console.error('Error updating keeper status:', error.message);
      throw error;
    }
  }

  /**
   * Update all keeper selections for a team
   * @param {number} teamId - The team's ID
   * @param {Array<number>} keeperIds - Array of player IDs to be keepers
   * @param {number} userId - The user performing the action (for logging)
   * @returns {Promise<boolean>} - True if successful
   */
  static async updateAllKeepers(teamId, keeperIds, userId = 0) {
    try {
      // Start a transaction
      const conn = await db.pool.getConnection();
      await conn.beginTransaction();
      
      try {
        // First, unmark all players as keepers
        await conn.query(
          'UPDATE fantasy_team_players SET is_keeper = 0 WHERE fantasy_team_id = ?',
          [teamId]
        );
        
        // Then, mark selected players as keepers
        if (keeperIds.length > 0) {
          const placeholders = keeperIds.map(() => '?').join(',');
          await conn.query(
            `UPDATE fantasy_team_players SET is_keeper = 1 
             WHERE fantasy_team_id = ? AND player_id IN (${placeholders})`,
            [teamId, ...keeperIds]
          );
        }
        
        // Log activity
        await conn.query(
          `INSERT INTO activity_logs 
           (user_id, action_type, entity_type, entity_id, details) 
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            'KEEPERS_UPDATED',
            'FANTASY_TEAM',
            teamId,
            `Updated keeper selections (${keeperIds.length} keepers)`
          ]
        );
        
        await conn.commit();
        return true;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('Error updating all keepers:', error.message);
      throw error;
    }
  }

  /**
   * Get count of keepers for a team
   * @param {number} teamId - The team's ID
   * @returns {Promise<number>} - Number of keepers
   */
  static async getKeeperCount(teamId) {
    try {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM fantasy_team_players WHERE fantasy_team_id = ? AND is_keeper = 1',
        [teamId]
      );
      
      return result[0].count;
    } catch (error) {
      console.error('Error getting keeper count:', error.message);
      throw error;
    }
  }

  /**
   * Get available players (not on any roster)
   * @returns {Promise<Array>} - Array of available players
   */
  static async getAvailablePlayers() {
    try {
      const players = await db.query(
        `SELECT p.*, t.team_name, t.team_code 
         FROM nfl_players p
         LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
         WHERE p.player_id NOT IN (
           SELECT player_id FROM fantasy_team_players
         )
         ORDER BY 
            CASE 
                WHEN p.position = 'QB' THEN 1
                WHEN p.position = 'RB' THEN 2
                WHEN p.position = 'RC' THEN 3
                WHEN p.position = 'PK' THEN 4
                WHEN p.position = 'DU' THEN 5
                ELSE 6
            END,
           p.last_name, p.first_name`
      );
      
      return players;
    } catch (error) {
      console.error('Error getting available players:', error.message);
      throw error;
    }
  }

  /**
   * Get dynamic keeper limit for a team based on protection slots
   * @param {number} teamId - The team's ID
   * @returns {Promise<number>} - Maximum keepers allowed for this team
   */
  static async getKeeperLimit(teamId) {
    try {
      const result = await db.query(
        'SELECT base_slots + additional_slots as keeper_limit FROM team_keeper_slots WHERE fantasy_team_id = ?',
        [teamId]
      );
      
      // If no record exists, create one with default values
      if (result.length === 0) {
        await db.query(
          'INSERT INTO team_keeper_slots (fantasy_team_id, base_slots, additional_slots) VALUES (?, 12, 0)',
          [teamId]
        );
        return 12; // Default keeper limit
      }
      
      return result[0].keeper_limit;
    } catch (error) {
      console.error('Error getting keeper limit:', error.message);
      throw error;
    }
  }

  /**
   * Get current league settings
   * @returns {Promise<Object|null>} - League settings object
   */
  static async getLeagueSettings() {
    try {
      const result = await db.query(
        'SELECT * FROM league_settings ORDER BY season_year DESC LIMIT 1'
      );
      
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting league settings:', error.message);
      throw error;
    }
  }

  /**
   * Check if keeper deadline has passed (with proper timezone handling)
   * @returns {Promise<boolean>} - True if deadline has passed
   */
  static async isKeeperDeadlinePassed() {
    try {
      const { checkDeadline } = require('../utils/timezoneFix');
      
      const settings = await this.getLeagueSettings();
      if (!settings || !settings.keeper_deadline_date) {
        console.log('No keeper deadline set, allowing changes');
        return false; // No deadline set, allow changes
      }
      
      // Use proper timezone-aware deadline checking
      const result = checkDeadline(settings.keeper_deadline_date, 'America/Chicago');
      
      // Enhanced logging for debugging
      console.log('=== KEEPER DEADLINE CHECK ===');
      console.log('Deadline setting from DB:', settings.keeper_deadline_date);
      console.log('Parsed deadline (Chicago):', result.formattedDeadline);
      console.log('Current time (Chicago):', result.formattedNow);
      console.log('Current time (UTC):', new Date().toISOString());
      console.log('Time remaining (hours):', result.timeRemainingHours);
      console.log('Is deadline passed?', result.isPast);
      console.log('Raw deadline object:', result.deadline);
      console.log('Raw now object:', result.now);
      console.log('Time difference (ms):', result.timeRemaining);
      console.log('==============================');
      
      return result.isPast;
    } catch (error) {
      console.error('Error checking keeper deadline:', error.message);
      console.error('Stack trace:', error.stack);
      return false; // Allow changes if error occurs
    }
  }
}

module.exports = FantasyTeam;