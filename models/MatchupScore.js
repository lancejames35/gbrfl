const db = require('../config/database');

class MatchupScore {
  /**
   * Create or update a matchup score
   * @param {Object} scoreData - Score data
   * @returns {Promise<Object>} Created/updated score
   */
  static async upsertScore(scoreData) {
    try {
      const { schedule_id, week_number, season_year, game_type, team_1_score, team_2_score, updated_by } = scoreData;

      const query = `
        INSERT INTO matchup_scores
          (schedule_id, week_number, season_year, game_type, team_1_score, team_2_score, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          team_1_score = VALUES(team_1_score),
          team_2_score = VALUES(team_2_score),
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP
      `;

      const result = await db.query(query, [
        schedule_id,
        week_number,
        season_year,
        game_type,
        team_1_score,
        team_2_score,
        updated_by
      ]);

      return result;
    } catch (error) {
      console.error('Error upserting matchup score:', error);
      throw error;
    }
  }

  /**
   * Get scores for a specific week
   * @param {number} weekNumber - Week number
   * @param {number} seasonYear - Season year
   * @param {string} gameType - Game type (optional)
   * @returns {Promise<Array>} Array of scores
   */
  static async getScoresByWeek(weekNumber, seasonYear = 2025, gameType = null) {
    try {
      let query = `
        SELECT
          ms.*,
          ws.team_1_position,
          ws.team_2_position
        FROM matchup_scores ms
        JOIN weekly_schedule ws ON ms.schedule_id = ws.schedule_id
        WHERE ms.week_number = ? AND ms.season_year = ?
      `;

      const params = [weekNumber, seasonYear];

      if (gameType) {
        query += ' AND ms.game_type = ?';
        params.push(gameType);
      }

      query += ' ORDER BY ms.game_type DESC, ms.score_id';

      const scores = await db.query(query, params);
      return scores;
    } catch (error) {
      console.error('Error fetching scores by week:', error);
      throw error;
    }
  }

  /**
   * Get score for a specific matchup
   * @param {number} scheduleId - Schedule ID
   * @param {number} seasonYear - Season year
   * @returns {Promise<Object|null>} Score object or null
   */
  static async getScoreByScheduleId(scheduleId, seasonYear = 2025) {
    try {
      const query = `
        SELECT * FROM matchup_scores
        WHERE schedule_id = ? AND season_year = ?
      `;

      const scores = await db.query(query, [scheduleId, seasonYear]);
      return scores.length > 0 ? scores[0] : null;
    } catch (error) {
      console.error('Error fetching score by schedule ID:', error);
      throw error;
    }
  }

  /**
   * Batch upsert scores for multiple matchups
   * @param {Array} scoresArray - Array of score objects
   * @returns {Promise<Object>} Result
   */
  static async batchUpsertScores(scoresArray) {
    try {
      const promises = scoresArray.map(score => this.upsertScore(score));
      const results = await Promise.all(promises);
      return { success: true, count: results.length };
    } catch (error) {
      console.error('Error batch upserting scores:', error);
      throw error;
    }
  }

  /**
   * Delete score for a specific matchup
   * @param {number} scheduleId - Schedule ID
   * @param {number} seasonYear - Season year
   * @returns {Promise<Object>} Result
   */
  static async deleteScore(scheduleId, seasonYear = 2025) {
    try {
      const query = `
        DELETE FROM matchup_scores
        WHERE schedule_id = ? AND season_year = ?
      `;

      const result = await db.query(query, [scheduleId, seasonYear]);
      return result;
    } catch (error) {
      console.error('Error deleting matchup score:', error);
      throw error;
    }
  }

  /**
   * Check if scores exist for a week
   * @param {number} weekNumber - Week number
   * @param {number} seasonYear - Season year
   * @param {string} gameType - Game type (optional)
   * @returns {Promise<boolean>} True if scores exist
   */
  static async hasScores(weekNumber, seasonYear = 2025, gameType = null) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM matchup_scores
        WHERE week_number = ? AND season_year = ?
      `;

      const params = [weekNumber, seasonYear];

      if (gameType) {
        query += ' AND game_type = ?';
        params.push(gameType);
      }

      const result = await db.query(query, params);
      return result[0].count > 0;
    } catch (error) {
      console.error('Error checking if scores exist:', error);
      throw error;
    }
  }

  /**
   * Get all scores for a season
   * @param {number} seasonYear - Season year
   * @returns {Promise<Array>} Array of all scores
   */
  static async getSeasonScores(seasonYear = 2025) {
    try {
      const query = `
        SELECT
          ms.*,
          ws.team_1_position,
          ws.team_2_position
        FROM matchup_scores ms
        JOIN weekly_schedule ws ON ms.schedule_id = ws.schedule_id
        WHERE ms.season_year = ?
        ORDER BY ms.week_number, ms.game_type DESC, ms.score_id
      `;

      const scores = await db.query(query, [seasonYear]);
      return scores;
    } catch (error) {
      console.error('Error fetching season scores:', error);
      throw error;
    }
  }
}

module.exports = MatchupScore;
