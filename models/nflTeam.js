/**
 * NFL Team Model
 * Handles all NFL team-related database operations
 */

const db = require('../config/database');

class NFLTeam {
  /**
   * Find a team by ID
   * @param {number} teamId - The team's ID
   * @returns {Promise<Object|null>} - The team object or null if not found
   */
  static async findById(teamId) {
    try {
      const teams = await db.query(
        'SELECT * FROM nfl_teams WHERE nfl_team_id = ?',
        [teamId]
      );
      return teams.length ? teams[0] : null;
    } catch (error) {
      console.error('Error finding NFL team by ID:', error.message);
      throw error;
    }
  }

  /**
   * Find a team by code
   * @param {string} teamCode - The team's code (e.g., 'NE', 'DAL')
   * @returns {Promise<Object|null>} - The team object or null if not found
   */
  static async findByCode(teamCode) {
    try {
      const teams = await db.query(
        'SELECT * FROM nfl_teams WHERE team_code = ?',
        [teamCode]
      );
      return teams.length ? teams[0] : null;
    } catch (error) {
      console.error('Error finding NFL team by code:', error.message);
      throw error;
    }
  }

  /**
   * Get all NFL teams
   * @returns {Promise<Array>} - Array of team objects
   */
  static async getAll() {
    try {
      const teams = await db.query(
        'SELECT * FROM nfl_teams ORDER BY conference, division, team_name'
      );
      return teams;
    } catch (error) {
      console.error('Error getting all NFL teams:', error.message);
      throw error;
    }
  }

  /**
   * Create a new NFL team
   * @param {Object} teamData - Team data
   * @returns {Promise<number>} - The ID of the newly created team
   */
  static async create(teamData) {
    try {
      const result = await db.query(
        'INSERT INTO nfl_teams (team_name, team_code, conference, division, head_coach) VALUES (?, ?, ?, ?, ?)',
        [
          teamData.teamName,
          teamData.teamCode,
          teamData.conference,
          teamData.division,
          teamData.headCoach || null
        ]
      );
      
      // Log activity
      if (result.insertId) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [
            teamData.userId || null,
            'NFL_TEAM_CREATED',
            'NFL_TEAM',
            result.insertId,
            `New NFL team added: ${teamData.teamName} (${teamData.teamCode})`
          ]
        );
      }
      
      return result.insertId;
    } catch (error) {
      console.error('Error creating NFL team:', error.message);
      throw error;
    }
  }

  /**
   * Update an NFL team
   * @param {number} teamId - The ID of the team to update
   * @param {Object} teamData - Updated team data
   * @param {number} userId - ID of the user making the update
   * @returns {Promise<boolean>} - True if successful
   */
  static async update(teamId, teamData, userId) {
    try {
      // Start building the query
      let query = 'UPDATE nfl_teams SET ';
      const params = [];
      
      // Add fields to update
      if (teamData.teamName) {
        query += 'team_name = ?, ';
        params.push(teamData.teamName);
      }
      
      if (teamData.teamCode) {
        query += 'team_code = ?, ';
        params.push(teamData.teamCode);
      }
      
      if (teamData.conference) {
        query += 'conference = ?, ';
        params.push(teamData.conference);
      }
      
      if (teamData.division) {
        query += 'division = ?, ';
        params.push(teamData.division);
      }
      
      if (teamData.headCoach !== undefined) {
        query += 'head_coach = ?, ';
        params.push(teamData.headCoach);
      }
      
      // Remove trailing comma and space
      query = query.slice(0, -2);
      
      // Add WHERE clause
      query += ' WHERE nfl_team_id = ?';
      params.push(teamId);
      
      // Execute query
      const result = await db.query(query, params);
      
      // Log activity
      if (result.affectedRows > 0) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [
            userId || null,
            'NFL_TEAM_UPDATED',
            'NFL_TEAM',
            teamId,
            `NFL team updated: ID ${teamId}`
          ]
        );
      }
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating NFL team:', error.message);
      throw error;
    }
  }

  /**
   * Get teams by conference
   * @param {string} conference - Conference (AFC or NFC)
   * @returns {Promise<Array>} - Array of team objects
   */
  static async getByConference(conference) {
    try {
      const teams = await db.query(
        'SELECT * FROM nfl_teams WHERE conference = ? ORDER BY division, team_name',
        [conference]
      );
      return teams;
    } catch (error) {
      console.error('Error getting NFL teams by conference:', error.message);
      throw error;
    }
  }

  /**
   * Get teams by division
   * @param {string} conference - Conference (AFC or NFC)
   * @param {string} division - Division (East, North, South, West)
   * @returns {Promise<Array>} - Array of team objects
   */
  static async getByDivision(conference, division) {
    try {
      const teams = await db.query(
        'SELECT * FROM nfl_teams WHERE conference = ? AND division = ? ORDER BY team_name',
        [conference, division]
      );
      return teams;
    } catch (error) {
      console.error('Error getting NFL teams by division:', error.message);
      throw error;
    }
  }

  /**
   * Get players on a team
   * @param {number} teamId - The NFL team ID
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} - Array of player objects
   */
  static async getPlayers(teamId, options = {}) {
    try {
      const {
        position = null,
        limit = 50,
        offset = 0
      } = options;

      // Build the query
      let query = `
        SELECT * FROM nfl_players
        WHERE nfl_team_id = ?
      `;
      
      const params = [teamId];
      
      // Add filters
      if (position) {
        query += ' AND position = ?';
        params.push(position);
      }
      
      // Add sorting
      query += ' ORDER BY position, last_name, first_name';
      
      // Add pagination
      query += ' LIMIT ? OFFSET ?';
      params.push(Number(limit), Number(offset));
      
      const players = await db.query(query, params);
      return players;
    } catch (error) {
      console.error('Error getting players by NFL team:', error.message);
      throw error;
    }
  }
}

module.exports = NFLTeam;