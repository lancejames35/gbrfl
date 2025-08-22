const db = require('../config/database');

class ScheduleAssignment {
  /**
   * Get all schedule assignments for the current season
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of schedule assignments with team information
   */
  static async getAllAssignments(seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sa.assignment_id,
          sa.schedule_position,
          sa.fantasy_team_id,
          sa.season_year,
          sa.created_at,
          ft.team_name,
          u.username,
          u.first_name,
          u.last_name
        FROM schedule_assignments sa
        LEFT JOIN fantasy_teams ft ON sa.fantasy_team_id = ft.team_id
        LEFT JOIN users u ON ft.user_id = u.user_id
        WHERE sa.season_year = ?
        ORDER BY sa.schedule_position
      `;
      
      const assignments = await db.query(query, [seasonYear]);
      return assignments;
    } catch (error) {
      console.error('Error fetching schedule assignments:', error);
      throw error;
    }
  }

  /**
   * Get schedule assignment by team ID
   * @param {number} teamId - The team ID
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object|null>} Schedule assignment or null
   */
  static async getByTeamId(teamId, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sa.*,
          ft.team_name
        FROM schedule_assignments sa
        LEFT JOIN fantasy_teams ft ON sa.fantasy_team_id = ft.team_id
        WHERE sa.fantasy_team_id = ? AND sa.season_year = ?
        LIMIT 1
      `;
      
      const results = await db.query(query, [teamId, seasonYear]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error fetching assignment by team ID:', error);
      throw error;
    }
  }

  /**
   * Get schedule assignment by position number
   * @param {number} positionNumber - The position number (1-10)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object|null>} Schedule assignment or null
   */
  static async getByPosition(positionNumber, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sa.*,
          ft.team_name,
          u.username,
          u.first_name,
          u.last_name
        FROM schedule_assignments sa
        LEFT JOIN fantasy_teams ft ON sa.fantasy_team_id = ft.team_id
        LEFT JOIN users u ON ft.user_id = u.user_id
        WHERE sa.schedule_position = ? AND sa.season_year = ?
        LIMIT 1
      `;
      
      const results = await db.query(query, [positionNumber, seasonYear]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error fetching assignment by position:', error);
      throw error;
    }
  }

  /**
   * Create a new schedule assignment
   * @param {Object} assignmentData - The assignment data
   * @returns {Promise<Object>} Created assignment
   */
  static async createAssignment(assignmentData) {
    try {
      const { schedule_position, fantasy_team_id, season_year = 2025 } = assignmentData;
      
      // First check if position is already taken
      const existingPosition = await this.getByPosition(schedule_position, season_year);
      if (existingPosition) {
        throw new Error(`Position ${schedule_position} is already assigned to team ${existingPosition.team_name}`);
      }
      
      // Check if team is already assigned
      const existingTeam = await this.getByTeamId(fantasy_team_id, season_year);
      if (existingTeam) {
        throw new Error(`Team is already assigned to position ${existingTeam.schedule_position}`);
      }
      
      const query = `
        INSERT INTO schedule_assignments (schedule_position, fantasy_team_id, season_year)
        VALUES (?, ?, ?)
      `;
      
      const result = await db.query(query, [schedule_position, fantasy_team_id, season_year]);
      
      return {
        assignment_id: result.insertId,
        schedule_position,
        fantasy_team_id,
        season_year
      };
    } catch (error) {
      console.error('Error creating schedule assignment:', error);
      throw error;
    }
  }

  /**
   * Update an existing schedule assignment
   * @param {number} assignmentId - The assignment ID
   * @param {Object} updateData - The data to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateAssignment(assignmentId, updateData) {
    try {
      const { schedule_position, fantasy_team_id } = updateData;
      
      const query = `
        UPDATE schedule_assignments
        SET schedule_position = ?, fantasy_team_id = ?
        WHERE assignment_id = ?
      `;
      
      const result = await db.query(query, [schedule_position, fantasy_team_id, assignmentId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating schedule assignment:', error);
      throw error;
    }
  }

  /**
   * Delete a schedule assignment
   * @param {number} assignmentId - The assignment ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteAssignment(assignmentId) {
    try {
      const query = 'DELETE FROM schedule_assignments WHERE assignment_id = ?';
      const result = await db.query(query, [assignmentId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting schedule assignment:', error);
      throw error;
    }
  }

  /**
   * Delete assignment by team ID
   * @param {number} teamId - The team ID
   * @param {number} seasonYear - The season year
   * @returns {Promise<boolean>} Success status
   */
  static async deleteByTeamId(teamId, seasonYear = 2025) {
    try {
      const query = 'DELETE FROM schedule_assignments WHERE fantasy_team_id = ? AND season_year = ?';
      const result = await db.query(query, [teamId, seasonYear]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting assignment by team ID:', error);
      throw error;
    }
  }

  /**
   * Bulk update assignments (for drag-and-drop operations)
   * @param {Array} assignments - Array of {schedule_position, fantasy_team_id} objects
   * @param {number} seasonYear - The season year
   * @returns {Promise<boolean>} Success status
   */
  static async bulkUpdateAssignments(assignments, seasonYear = 2025) {
    const connection = await db.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Clear existing assignments for the season
      await connection.query(
        'DELETE FROM schedule_assignments WHERE season_year = ?',
        [seasonYear]
      );
      
      // Insert new assignments
      for (const assignment of assignments) {
        if (assignment.fantasy_team_id) {
          await connection.query(
            'INSERT INTO schedule_assignments (schedule_position, fantasy_team_id, season_year) VALUES (?, ?, ?)',
            [assignment.schedule_position, assignment.fantasy_team_id, seasonYear]
          );
        }
      }
      
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      console.error('Error in bulk update assignments:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = ScheduleAssignment;