const db = require('../config/database');

class PlayoffLineupPosition {
  /**
   * Get full roster organized by position for playoff lineup
   * @param {number} teamId - The fantasy team ID
   * @param {number} playoffLineupId - The playoff lineup submission ID (optional)
   * @returns {Promise<Object>} Object with arrays of players by position
   */
  static async getTeamRosterByPosition(teamId, playoffLineupId = null) {
    try {
      // Get rostered players
      const rosterQuery = `
        SELECT
          ftp.player_id,
          p.display_name as player_name,
          p.position as player_position,
          p.first_name,
          p.last_name,
          pt.team_name as player_team_name,
          pt.team_code as player_team_code,
          pt.team_code as team_abbrev,
          CASE
            WHEN p.position IN ('QB') THEN 'quarterback'
            WHEN p.position IN ('RB') THEN 'running_back'
            WHEN p.position IN ('RC') THEN 'receiver'
            WHEN p.position IN ('PK') THEN 'place_kicker'
            WHEN p.position IN ('DU') THEN 'defense'
            ELSE 'other'
          END as position_type,
          'rostered' as player_status,
          NULL as waiver_request_id
        FROM fantasy_team_players ftp
        JOIN nfl_players p ON ftp.player_id = p.player_id
        LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
        WHERE ftp.fantasy_team_id = ?
        AND p.position IN ('QB', 'RB', 'RC', 'PK', 'DU')

        UNION ALL

        SELECT
          p.player_id,
          p.display_name as player_name,
          p.position as player_position,
          p.first_name,
          p.last_name,
          pt.team_name as player_team_name,
          pt.team_code as player_team_code,
          pt.team_code as team_abbrev,
          CASE
            WHEN p.position IN ('QB') THEN 'quarterback'
            WHEN p.position IN ('RB') THEN 'running_back'
            WHEN p.position IN ('RC') THEN 'receiver'
            WHEN p.position IN ('PK') THEN 'place_kicker'
            WHEN p.position IN ('DU') THEN 'defense'
            ELSE 'other'
          END as position_type,
          'pending_waiver' as player_status,
          MIN(wr.request_id) as waiver_request_id
        FROM waiver_requests wr
        JOIN nfl_players p ON wr.pickup_player_id = p.player_id
        LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
        WHERE wr.fantasy_team_id = ?
        AND wr.status = 'pending'
        AND p.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
        GROUP BY p.player_id

        ORDER BY position_type, player_name
      `;

      const roster = await db.query(rosterQuery, [teamId, teamId]);

      // Organize by position
      const byPosition = {
        quarterback: [],
        running_back: [],
        receiver: [],
        place_kicker: [],
        defense: []
      };

      roster.forEach(player => {
        if (byPosition[player.position_type]) {
          byPosition[player.position_type].push(player);
        }
      });

      return byPosition;
    } catch (error) {
      console.error('Error fetching team roster by position:', error);
      throw error;
    }
  }

  /**
   * Get playoff lineup positions for a specific lineup
   * @param {number} playoffLineupId - The playoff lineup ID
   * @returns {Promise<Object>} Object with arrays of lineup entries by position
   */
  static async getLineupPositions(playoffLineupId) {
    try {
      const query = `
        SELECT
          plp.*,
          p.display_name as player_name,
          p.first_name,
          p.last_name,
          p.position as player_position,
          pt.team_code as team_abbrev,
          pt.team_name as player_team_name
        FROM playoff_lineup_positions plp
        JOIN nfl_players p ON plp.player_id = p.player_id
        LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
        WHERE plp.playoff_lineup_id = ?
        ORDER BY plp.position_type, plp.sort_order
      `;

      const positions = await db.query(query, [playoffLineupId]);

      // Organize by position type
      const byPosition = {
        quarterback: [],
        running_back: [],
        receiver: [],
        place_kicker: [],
        defense: []
      };

      positions.forEach(pos => {
        if (byPosition[pos.position_type]) {
          byPosition[pos.position_type].push(pos);
        }
      });

      return byPosition;
    } catch (error) {
      console.error('Error fetching playoff lineup positions:', error);
      throw error;
    }
  }

  /**
   * Save playoff lineup positions (replaces all existing positions)
   * @param {number} playoffLineupId - The playoff lineup ID
   * @param {Array} positions - Array of position objects
   * @returns {Promise<boolean>} Success status
   */
  static async saveLineupPositions(playoffLineupId, positions) {
    try {
      // Delete existing positions
      await db.query(
        'DELETE FROM playoff_lineup_positions WHERE playoff_lineup_id = ?',
        [playoffLineupId]
      );

      // Insert new positions
      if (positions && positions.length > 0) {
        const insertQuery = `
          INSERT INTO playoff_lineup_positions (
            playoff_lineup_id, position_type, player_id, playoff_round,
            sort_order, player_status, waiver_request_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        for (const pos of positions) {
          await db.query(insertQuery, [
            playoffLineupId,
            pos.position_type,
            pos.player_id,
            pos.playoff_round,
            pos.sort_order,
            pos.player_status || 'rostered',
            pos.waiver_request_id || null
          ]);
        }
      }

      return true;
    } catch (error) {
      console.error('Error saving playoff lineup positions:', error);
      throw error;
    }
  }

  /**
   * Add a single player to playoff lineup
   * @param {number} playoffLineupId - The playoff lineup ID
   * @param {Object} positionData - Position data
   * @returns {Promise<number>} Created position ID
   */
  static async addPosition(playoffLineupId, positionData) {
    try {
      const {
        position_type,
        player_id,
        playoff_round,
        sort_order,
        player_status = 'rostered',
        waiver_request_id = null
      } = positionData;

      const query = `
        INSERT INTO playoff_lineup_positions (
          playoff_lineup_id, position_type, player_id, playoff_round,
          sort_order, player_status, waiver_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await db.query(query, [
        playoffLineupId,
        position_type,
        player_id,
        playoff_round,
        sort_order,
        player_status,
        waiver_request_id
      ]);

      return result.insertId;
    } catch (error) {
      console.error('Error adding playoff lineup position:', error);
      throw error;
    }
  }

  /**
   * Remove a player from a specific playoff round
   * @param {number} playoffLineupId - The playoff lineup ID
   * @param {number} playerId - The player ID
   * @param {string} playoffRound - The playoff round
   * @returns {Promise<boolean>} Success status
   */
  static async removePosition(playoffLineupId, playerId, playoffRound) {
    try {
      const query = `
        DELETE FROM playoff_lineup_positions
        WHERE playoff_lineup_id = ?
        AND player_id = ?
        AND playoff_round = ?
      `;

      await db.query(query, [playoffLineupId, playerId, playoffRound]);
      return true;
    } catch (error) {
      console.error('Error removing playoff lineup position:', error);
      throw error;
    }
  }

  /**
   * Update sort order for positions within a position type
   * @param {number} playoffLineupId - The playoff lineup ID
   * @param {string} positionType - The position type
   * @param {Array} newOrder - Array of {playoff_position_id, sort_order}
   * @returns {Promise<boolean>} Success status
   */
  static async updateSortOrder(playoffLineupId, positionType, newOrder) {
    try {
      for (const item of newOrder) {
        await db.query(
          `UPDATE playoff_lineup_positions
           SET sort_order = ?
           WHERE playoff_position_id = ?
           AND playoff_lineup_id = ?
           AND position_type = ?`,
          [item.sort_order, item.playoff_position_id, playoffLineupId, positionType]
        );
      }

      return true;
    } catch (error) {
      console.error('Error updating sort order:', error);
      throw error;
    }
  }

  /**
   * Get count of positions by playoff round
   * @param {number} playoffLineupId - The playoff lineup ID
   * @returns {Promise<Object>} Count by round
   */
  static async getCountByRound(playoffLineupId) {
    try {
      const query = `
        SELECT playoff_round, COUNT(*) as count
        FROM playoff_lineup_positions
        WHERE playoff_lineup_id = ?
        GROUP BY playoff_round
      `;

      const results = await db.query(query, [playoffLineupId]);

      const counts = {
        week18: 0,
        wildcard: 0,
        divisional: 0,
        conference: 0,
        superbowl: 0
      };

      results.forEach(row => {
        counts[row.playoff_round] = row.count;
      });

      return counts;
    } catch (error) {
      console.error('Error getting count by round:', error);
      throw error;
    }
  }
}

module.exports = PlayoffLineupPosition;
