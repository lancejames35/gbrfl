const db = require('../config/database');

class LineupPosition {
  /**
   * Get full roster by position with current lineup order
   * @param {number} teamId - The fantasy team ID
   * @param {number} lineupId - The lineup submission ID (optional)
   * @returns {Promise<Object>} Object with arrays of players by position
   */
  static async getTeamRosterByPosition(teamId, lineupId = null) {
    try {
      const query = `
        SELECT 
          rostered_players.player_id,
          rostered_players.player_name,
          rostered_players.player_position,
          rostered_players.first_name,
          rostered_players.last_name,
          rostered_players.player_team_name,
          rostered_players.player_team_code,
          rostered_players.team_abbrev,
          rostered_players.position_type,
          rostered_players.sort_order,
          rostered_players.in_lineup,
          'rostered' as player_status,
          NULL as waiver_request_id
        FROM (
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
            COALESCE(lp.sort_order, 999) as sort_order,
            CASE WHEN lp.position_id IS NOT NULL THEN 1 ELSE 0 END as in_lineup
          FROM fantasy_team_players ftp
          JOIN nfl_players p ON ftp.player_id = p.player_id
          LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
          LEFT JOIN lineup_positions lp ON (
            ftp.player_id = lp.player_id 
            AND lp.lineup_id = ?
            AND lp.position_type = CASE 
              WHEN p.position IN ('QB') THEN 'quarterback'
              WHEN p.position IN ('RB') THEN 'running_back'
              WHEN p.position IN ('RC') THEN 'receiver'
              WHEN p.position IN ('PK') THEN 'place_kicker'
              WHEN p.position IN ('DU') THEN 'defense'
              ELSE 'other'
            END
          )
          WHERE ftp.fantasy_team_id = ?
          AND p.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
        ) as rostered_players
        
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
          COALESCE(lp.sort_order, 1000) as sort_order,
          CASE WHEN lp.position_id IS NOT NULL THEN 1 ELSE 0 END as in_lineup,
          'pending_waiver' as player_status,
          wr.request_id as waiver_request_id
        FROM waiver_requests wr
        JOIN nfl_players p ON wr.pickup_player_id = p.player_id
        LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
        LEFT JOIN lineup_positions lp ON (
          p.player_id = lp.player_id 
          AND lp.lineup_id = ?
          AND lp.position_type = CASE 
            WHEN p.position IN ('QB') THEN 'quarterback'
            WHEN p.position IN ('RB') THEN 'running_back'
            WHEN p.position IN ('RC') THEN 'receiver'
            WHEN p.position IN ('PK') THEN 'place_kicker'
            WHEN p.position IN ('DU') THEN 'defense'
            ELSE 'other'
          END
        )
        WHERE wr.fantasy_team_id = ?
        AND wr.status = 'pending'
        AND p.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
        
        ORDER BY position_type, 
                 CASE WHEN player_status = 'rostered' THEN 0 ELSE 1 END,
                 sort_order, 
                 last_name, 
                 first_name
      `;

      const results = await db.query(query, [lineupId, teamId, lineupId, teamId]);
      
      console.log('=== LOADING ROSTER BY POSITION ===');
      console.log('Lineup ID:', lineupId, 'Team ID:', teamId);
      console.log('Total results:', results.length);
      
      // Log pending players specifically
      const pendingPlayers = results.filter(p => p.player_status === 'pending_waiver');
      console.log('Pending waiver players found:', pendingPlayers.length);
      pendingPlayers.forEach(p => {
        console.log(`Pending: Player ${p.player_id}, Position: ${p.position_type}, Sort: ${p.sort_order}, In lineup: ${p.in_lineup}`);
      });
      console.log('=== END LOADING ROSTER ===');
      
      // Group by position
      const roster = {
        quarterback: [],
        running_back: [],
        receiver: [],
        place_kicker: [],
        defense: []
      };

      results.forEach(player => {
        if (roster[player.position_type]) {
          roster[player.position_type].push(player);
        }
      });

      // Defense players are now included in the main query above

      return roster;
    } catch (error) {
      console.error('Error fetching team roster by position:', error);
      throw error;
    }
  }

  /**
   * Get all positions for a lineup (legacy method for compatibility)
   * @param {number} lineupId - The lineup submission ID
   * @returns {Promise<Array>} Array of lineup positions with player/team details
   */
  static async getByLineup(lineupId) {
    try {
      const query = `
        SELECT 
          lp.*,
          p.display_name as player_name,
          p.position as player_position,
          p.first_name,
          p.last_name,
          nt.team_name as nfl_team_name,
          nt.team_code as nfl_team_code,
          pt.team_name as player_team_name,
          pt.team_code as player_team_code,
          COALESCE(nt.team_code, pt.team_code) as team_abbrev
        FROM lineup_positions lp
        LEFT JOIN nfl_players p ON lp.player_id = p.player_id
        LEFT JOIN nfl_teams nt ON lp.nfl_team_id = nt.nfl_team_id
        LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
        WHERE lp.lineup_id = ?
        ORDER BY lp.position_type, lp.sort_order
      `;

      const results = await db.query(query, [lineupId]);
      
      // Return the raw results - let the template handle grouping
      return results;
    } catch (error) {
      console.error('Error fetching lineup positions:', error);
      throw error;
    }
  }

  /**
   * Update positions for a lineup (bulk operation)
   * @param {number} lineupId - The lineup submission ID
   * @param {Array} positions - Array of position updates
   * @returns {Promise<boolean>} Success status
   */
  static async updatePositions(lineupId, positions) {
    const connection = await db.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Delete existing positions for this lineup
      await connection.query('DELETE FROM lineup_positions WHERE lineup_id = ?', [lineupId]);

      // Insert new positions
      for (const position of positions) {
        const {
          position_type,
          player_id,
          nfl_team_id,
          sort_order
        } = position;

        console.log('Inserting position:', {
          lineupId,
          position_type,
          player_id,
          nfl_team_id,
          sort_order
        });

        try {
          await connection.query(`
            INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
          `, [lineupId, position_type, player_id, nfl_team_id, sort_order]);
        } catch (insertError) {
          console.error('Error inserting position:', {
            position,
            error: insertError.message,
            code: insertError.code
          });
          throw insertError;
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      console.error('Error updating lineup positions:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Reorder positions within a position type
   * @param {number} lineupId - The lineup submission ID
   * @param {string} positionType - The position type
   * @param {Array} newOrder - Array of {position_id, sort_order} objects
   * @returns {Promise<boolean>} Success status
   */
  static async reorderPositions(lineupId, positionType, newOrder) {
    const connection = await db.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      for (const item of newOrder) {
        await connection.query(`
          UPDATE lineup_positions 
          SET sort_order = ?
          WHERE position_id = ? AND lineup_id = ? AND position_type = ?
        `, [item.sort_order, item.position_id, lineupId, positionType]);
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      console.error('Error reordering lineup positions:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Add a player to a position
   * @param {Object} positionData - Position data
   * @returns {Promise<number>} Created position ID
   */
  static async addPosition(positionData) {
    try {
      const {
        lineup_id,
        position_type,
        player_id,
        nfl_team_id,
        sort_order
      } = positionData;

      const query = `
        INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `;

      const result = await db.query(query, [lineup_id, position_type, player_id, nfl_team_id, sort_order]);
      return result.insertId;
    } catch (error) {
      console.error('Error adding lineup position:', error);
      throw error;
    }
  }

  /**
   * Remove a position
   * @param {number} positionId - The position ID
   * @returns {Promise<boolean>} Success status
   */
  static async removePosition(positionId) {
    try {
      const result = await db.query('DELETE FROM lineup_positions WHERE position_id = ?', [positionId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error removing lineup position:', error);
      throw error;
    }
  }

  /**
   * Delete all positions for a specific player across all lineups for a team
   * @param {number} playerId - The player ID
   * @param {number} fantasyTeamId - The fantasy team ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteByPlayer(playerId, fantasyTeamId) {
    try {
      const query = `
        DELETE lp FROM lineup_positions lp
        INNER JOIN lineup_submissions ls ON lp.lineup_id = ls.lineup_id
        WHERE lp.player_id = ? AND ls.fantasy_team_id = ?
      `;

      const result = await db.query(query, [playerId, fantasyTeamId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting player from lineups:', error);
      throw error;
    }
  }

  /**
   * Reorder positions after a player removal (close gaps in sort_order)
   * @param {number} lineupId - The lineup submission ID
   * @param {string} positionType - The position type
   * @returns {Promise<boolean>} Success status
   */
  static async reorderAfterRemoval(lineupId, positionType) {
    try {
      // Get all positions for this lineup and position type, ordered by sort_order
      const positions = await db.query(`
        SELECT position_id, sort_order
        FROM lineup_positions 
        WHERE lineup_id = ? AND position_type = ?
        ORDER BY sort_order
      `, [lineupId, positionType]);

      // Update sort_order to close gaps (1, 2, 3, 4, etc.)
      const connection = await db.pool.getConnection();
      
      try {
        await connection.beginTransaction();

        for (let i = 0; i < positions.length; i++) {
          const newSortOrder = i + 1;
          if (positions[i].sort_order !== newSortOrder) {
            await connection.query(`
              UPDATE lineup_positions 
              SET sort_order = ?
              WHERE position_id = ?
            `, [newSortOrder, positions[i].position_id]);
          }
        }

        await connection.commit();
        return true;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error reordering after removal:', error);
      throw error;
    }
  }

  /**
   * Get available players for a position type from team roster
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {string} positionType - The position type
   * @returns {Promise<Array>} Array of available players
   */
  static async getAvailablePlayersForPosition(fantasyTeamId, positionType) {
    try {
      let positionFilter = '';
      
      switch (positionType) {
        case 'quarterback':
          positionFilter = "p.position = 'QB'";
          break;
        case 'running_back':
          positionFilter = "p.position = 'RB'";
          break;
        case 'receiver':
          positionFilter = "p.position = 'RC'";
          break;
        case 'place_kicker':
          positionFilter = "p.position = 'PK'";
          break;
        case 'defense':
          positionFilter = "p.position = 'DU'";
          break;
        default:
          return [];
      }

      const query = `
        SELECT 
          p.*,
          nt.team_name as nfl_team_name,
          nt.team_code as nfl_team_code,
          ftp.acquisition_type,
          ftp.acquisition_date
        FROM fantasy_team_players ftp
        INNER JOIN nfl_players p ON ftp.player_id = p.player_id
        LEFT JOIN nfl_teams nt ON p.nfl_team_id = nt.nfl_team_id
        WHERE ftp.fantasy_team_id = ? AND ${positionFilter}
        ORDER BY p.last_name, p.first_name
      `;

      const results = await db.query(query, [fantasyTeamId]);
      return results;
    } catch (error) {
      console.error('Error fetching available players:', error);
      throw error;
    }
  }

  /**
   * Get all NFL teams for defense selection
   * @returns {Promise<Array>} Array of NFL teams
   */
  static async getAllNFLTeams() {
    try {
      const query = `
        SELECT 
          nfl_team_id as team_id,
          team_name,
          team_code,
          team_name as display_name
        FROM nfl_teams
        ORDER BY team_name
      `;

      const results = await db.query(query);
      return results;
    } catch (error) {
      console.error('Error fetching NFL teams:', error);
      throw error;
    }
  }

  /**
   * Get the next available sort order for a position type
   * @param {number} lineupId - The lineup submission ID
   * @param {string} positionType - The position type
   * @returns {Promise<number>} Next sort order
   */
  static async getNextSortOrder(lineupId, positionType) {
    try {
      const query = `
        SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order
        FROM lineup_positions 
        WHERE lineup_id = ? AND position_type = ?
      `;

      const results = await db.query(query, [lineupId, positionType]);
      return results[0].next_order;
    } catch (error) {
      console.error('Error getting next sort order:', error);
      throw error;
    }
  }

  /**
   * Move a position from one lineup to another (for copying)
   * @param {number} sourceLineupId - Source lineup ID
   * @param {number} targetLineupId - Target lineup ID
   * @param {string} positionType - Position type to copy
   * @returns {Promise<boolean>} Success status
   */
  static async copyPositionsFromLineup(sourceLineupId, targetLineupId, positionType = null) {
    try {
      let whereClause = 'WHERE lineup_id = ?';
      let params = [targetLineupId, sourceLineupId];
      
      if (positionType) {
        whereClause += ' AND position_type = ?';
        params = [targetLineupId, sourceLineupId, positionType];
      }

      const query = `
        INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
        SELECT ?, position_type, player_id, nfl_team_id, sort_order, NOW()
        FROM lineup_positions 
        ${whereClause}
        ORDER BY position_type, sort_order
      `;

      const result = await db.query(query, params);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error copying positions:', error);
      throw error;
    }
  }
}

module.exports = LineupPosition;