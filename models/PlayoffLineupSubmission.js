const db = require('../config/database');

class PlayoffLineupSubmission {
  /**
   * Get playoff lineup submission by team and season
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object|null>} Playoff lineup submission or null
   */
  static async getByTeamAndSeason(fantasyTeamId, seasonYear = 2025) {
    try {
      const query = `
        SELECT
          pls.*,
          ft.team_name,
          ft.user_id,
          u.username,
          u.first_name,
          u.last_name
        FROM playoff_lineup_submissions pls
        LEFT JOIN fantasy_teams ft ON pls.fantasy_team_id = ft.team_id
        LEFT JOIN users u ON ft.user_id = u.user_id
        WHERE pls.fantasy_team_id = ?
        AND pls.season_year = ?
        LIMIT 1
      `;

      const results = await db.query(query, [fantasyTeamId, seasonYear]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error fetching playoff lineup submission:', error);
      throw error;
    }
  }

  /**
   * Create a new playoff lineup submission
   * @param {Object} lineupData - The lineup data
   * @returns {Promise<number>} Created playoff lineup submission ID
   */
  static async createLineup(lineupData) {
    try {
      const {
        fantasy_team_id,
        season_year = 2025
      } = lineupData;

      const query = `
        INSERT INTO playoff_lineup_submissions (
          fantasy_team_id, season_year
        ) VALUES (?, ?)
      `;

      const result = await db.query(query, [fantasy_team_id, season_year]);
      return result.insertId;
    } catch (error) {
      console.error('Error creating playoff lineup submission:', error);
      throw error;
    }
  }

  /**
   * Update an existing playoff lineup submission
   * @param {number} playoffLineupId - The playoff lineup submission ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateLineup(playoffLineupId, updateData) {
    try {
      const allowedFields = ['season_year', 'submitted_at', 'is_locked'];
      const fields = [];
      const values = [];

      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = ?`);
          values.push(updateData[key]);
        }
      });

      if (fields.length === 0) {
        return false;
      }

      values.push(playoffLineupId);

      const query = `
        UPDATE playoff_lineup_submissions
        SET ${fields.join(', ')}
        WHERE playoff_lineup_id = ?
      `;

      await db.query(query, values);
      return true;
    } catch (error) {
      console.error('Error updating playoff lineup submission:', error);
      throw error;
    }
  }

  /**
   * Delete a playoff lineup submission and all its positions
   * @param {number} playoffLineupId - The playoff lineup submission ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteLineup(playoffLineupId) {
    try {
      const query = `DELETE FROM playoff_lineup_submissions WHERE playoff_lineup_id = ?`;
      await db.query(query, [playoffLineupId]);
      return true;
    } catch (error) {
      console.error('Error deleting playoff lineup submission:', error);
      throw error;
    }
  }

  /**
   * Check if Week 18 lineup is locked
   * @param {number} seasonYear - The season year
   * @returns {Promise<Object>} Lock status information
   */
  static async getWeek18LockStatus(seasonYear = 2025) {
    try {
      // Week 18 uses the same locking mechanism as regular weeks
      const query = `
        SELECT
          ll.lock_datetime,
          ll.is_locked,
          CASE
            WHEN ll.is_locked = 1 THEN 'locked'
            WHEN ll.lock_datetime <= NOW() THEN 'auto_locked'
            ELSE 'unlocked'
          END as current_status,
          TIMESTAMPDIFF(MINUTE, NOW(), ll.lock_datetime) as minutes_until_lock
        FROM lineup_locks ll
        WHERE ll.week_number = 18
        AND ll.season_year = ?
        LIMIT 1
      `;

      const results = await db.query(query, [seasonYear]);

      if (results.length > 0) {
        return results[0];
      }

      // If no lock exists, return unlocked status
      return {
        lock_datetime: null,
        is_locked: 0,
        current_status: 'unlocked',
        minutes_until_lock: null
      };
    } catch (error) {
      console.error('Error getting Week 18 lock status:', error);
      throw error;
    }
  }

  /**
   * Get all playoff lineup submissions for a season (admin)
   * @param {number} seasonYear - The season year
   * @returns {Promise<Array>} Array of playoff lineup submissions
   */
  static async getAllForSeason(seasonYear = 2025) {
    try {
      const query = `
        SELECT
          pls.*,
          ft.team_name,
          u.username,
          u.first_name,
          u.last_name,
          COUNT(plp.playoff_position_id) as total_positions
        FROM playoff_lineup_submissions pls
        LEFT JOIN fantasy_teams ft ON pls.fantasy_team_id = ft.team_id
        LEFT JOIN users u ON ft.user_id = u.user_id
        LEFT JOIN playoff_lineup_positions plp ON pls.playoff_lineup_id = plp.playoff_lineup_id
        WHERE pls.season_year = ?
        GROUP BY pls.playoff_lineup_id
        ORDER BY ft.team_name
      `;

      return await db.query(query, [seasonYear]);
    } catch (error) {
      console.error('Error fetching all playoff lineups for season:', error);
      throw error;
    }
  }
}

module.exports = PlayoffLineupSubmission;
