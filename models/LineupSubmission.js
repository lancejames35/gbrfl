const db = require('../config/database');

class LineupSubmission {
  /**
   * Get lineup submission by team and week
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {number} weekNumber - The week number (1-17)
   * @param {string} gameType - 'primary' or 'bonus'
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object|null>} Lineup submission or null
   */
  static async getByTeamAndWeek(fantasyTeamId, weekNumber, gameType = 'primary', seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          ls.*,
          ft.team_name,
          ft.user_id,
          u.username,
          u.first_name,
          u.last_name
        FROM lineup_submissions ls
        LEFT JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
        LEFT JOIN users u ON ft.user_id = u.user_id
        WHERE ls.fantasy_team_id = ? 
        AND ls.week_number = ? 
        AND ls.game_type = ? 
        AND ls.season_year = ?
        LIMIT 1
      `;
      
      const results = await db.query(query, [fantasyTeamId, weekNumber, gameType, seasonYear]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error fetching lineup submission:', error);
      throw error;
    }
  }

  /**
   * Create a new lineup submission
   * @param {Object} lineupData - The lineup data
   * @returns {Promise<number>} Created lineup submission ID
   */
  static async createLineup(lineupData) {
    try {
      const {
        fantasy_team_id,
        week_number,
        game_type = 'primary',
        season_year = 2025
      } = lineupData;

      // Simple insert with only the core required fields
      const query = `
        INSERT INTO lineup_submissions (
          fantasy_team_id, week_number, game_type, season_year
        ) VALUES (?, ?, ?, ?)
      `;

      const result = await db.query(query, [
        fantasy_team_id, week_number, game_type, season_year
      ]);

      return result.insertId;
    } catch (error) {
      console.error('Error creating lineup submission:', error);
      throw error;
    }
  }

  /**
   * Update an existing lineup submission
   * @param {number} lineupId - The lineup submission ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateLineup(lineupId, updateData) {
    try {
      // Allow updating fields that exist in the actual database schema
      const allowedFields = ['week_number', 'game_type', 'season_year', 'submitted_at', 'is_locked', 'head_coach'];
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

      values.push(lineupId);

      const query = `UPDATE lineup_submissions SET ${fields.join(', ')} WHERE lineup_id = ?`;
      const result = await db.query(query, values);

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating lineup submission:', error);
      throw error;
    }
  }

  /**
   * Get locked status for a week/game type
   * @param {number} weekNumber - The week number
   * @param {string} gameType - 'primary' or 'bonus'
   * @param {number} seasonYear - The season year
   * @returns {Promise<Object>} Lock status information
   */
  static async getLockedStatus(weekNumber, gameType = 'primary', seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          lock_time,
          is_locked,
          CASE 
            WHEN is_locked = 1 THEN 'locked'
            WHEN lock_time IS NULL THEN 'unlocked'
            WHEN NOW() >= lock_time THEN 'locked'
            ELSE 'unlocked'
          END as status,
          CASE 
            WHEN lock_time IS NOT NULL AND NOW() < lock_time 
            THEN TIMESTAMPDIFF(SECOND, NOW(), lock_time)
            ELSE 0
          END as seconds_until_lock
        FROM lineup_locks 
        WHERE week_number = ? 
        AND game_type = ? 
        AND season_year = ?
        LIMIT 1
      `;

      const results = await db.query(query, [weekNumber, gameType, seasonYear]);
      
      if (results.length === 0) {
        return {
          status: 'unlocked',
          lock_time: null,
          is_locked: 0,
          seconds_until_lock: null
        };
      }

      return results[0];
    } catch (error) {
      console.error('Error fetching lock status:', error);
      throw error;
    }
  }

  /**
   * Check if lineup is complete (all required positions filled)
   * @param {number} lineupId - The lineup submission ID
   * @returns {Promise<Object>} Completion status and details
   */
  static async isLineupComplete(lineupId) {
    try {
      const query = `
        SELECT 
          position_type,
          COUNT(*) as player_count,
          CASE position_type
            WHEN 'quarterback' THEN 2
            WHEN 'running_back' THEN 3
            WHEN 'receiver' THEN 3
            WHEN 'place_kicker' THEN 1
            WHEN 'defense' THEN 1
            ELSE 0
          END as required_count
        FROM lineup_positions 
        WHERE lineup_id = ? 
        AND sort_order <= (
          CASE position_type
            WHEN 'quarterback' THEN 2
            WHEN 'running_back' THEN 3
            WHEN 'receiver' THEN 3
            WHEN 'place_kicker' THEN 1
            WHEN 'defense' THEN 1
            ELSE 0
          END
        )
        GROUP BY position_type
      `;

      const results = await db.query(query, [lineupId]);
      
      const requirements = {
        quarterback: { required: 2, filled: 0 },
        running_back: { required: 3, filled: 0 },
        receiver: { required: 3, filled: 0 },
        place_kicker: { required: 1, filled: 0 },
        defense: { required: 1, filled: 0 }
      };

      let isComplete = true;
      const missing = [];

      results.forEach(row => {
        requirements[row.position_type].filled = row.player_count;
      });

      Object.keys(requirements).forEach(position => {
        const req = requirements[position];
        if (req.filled < req.required) {
          isComplete = false;
          missing.push({
            position: position,
            needed: req.required - req.filled,
            required: req.required,
            filled: req.filled
          });
        }
      });

      return {
        isComplete,
        requirements,
        missing
      };
    } catch (error) {
      console.error('Error checking lineup completion:', error);
      throw error;
    }
  }

  /**
   * Get all lineup submissions for a team in a season
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {number} seasonYear - The season year
   * @returns {Promise<Array>} Array of lineup submissions
   */
  static async getByTeamAndSeason(fantasyTeamId, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          ls.*,
          ll.lock_time,
          ll.is_locked,
          CASE 
            WHEN ll.is_locked = 1 THEN 'locked'
            WHEN ll.lock_time IS NULL THEN 'unlocked'
            WHEN NOW() >= ll.lock_time THEN 'locked'
            ELSE 'unlocked'
          END as lock_status
        FROM lineup_submissions ls
        LEFT JOIN lineup_locks ll ON ls.week_number = ll.week_number 
          AND ls.game_type = ll.game_type 
          AND ls.season_year = ll.season_year
        WHERE ls.fantasy_team_id = ? 
        AND ls.season_year = ?
        ORDER BY ls.week_number, ls.game_type
      `;

      const results = await db.query(query, [fantasyTeamId, seasonYear]);
      return results;
    } catch (error) {
      console.error('Error fetching team season lineups:', error);
      throw error;
    }
  }

  /**
   * Delete a lineup submission and all associated positions
   * @param {number} lineupId - The lineup submission ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteLineup(lineupId) {
    const connection = await db.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Delete lineup positions first (foreign key constraint)
      await connection.query('DELETE FROM lineup_positions WHERE lineup_id = ?', [lineupId]);
      
      // Delete lineup submission
      const result = await connection.query('DELETE FROM lineup_submissions WHERE lineup_id = ?', [lineupId]);

      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      console.error('Error deleting lineup submission:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Copy lineup from another week/game type
   * @param {Object} copyData - Source and target information
   * @returns {Promise<number>} New lineup submission ID
   */
  static async copyLineup(copyData) {
    const {
      source_lineup_id,
      fantasy_team_id,
      target_week,
      target_game_type,
      season_year = 2025
    } = copyData;

    const connection = await db.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Create new lineup submission
      const createResult = await connection.query(`
        INSERT INTO lineup_submissions (
          fantasy_team_id, week_number, game_type, season_year
        ) 
        VALUES (?, ?, ?, ?)
      `, [fantasy_team_id, target_week, target_game_type, season_year]);

      const newLineupId = createResult.insertId;

      // Copy all lineup positions
      await connection.query(`
        INSERT INTO lineup_positions (
          lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at
        )
        SELECT 
          ?, position_type, player_id, nfl_team_id, sort_order, NOW()
        FROM lineup_positions 
        WHERE lineup_id = ?
        ORDER BY position_type, sort_order
      `, [newLineupId, source_lineup_id]);

      await connection.commit();
      return newLineupId;
    } catch (error) {
      await connection.rollback();
      console.error('Error copying lineup:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = LineupSubmission;