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
      // Check if this lineup is for a locked week
      if (lineupId) {
        const lockCheckQuery = `
          SELECT ls.week_number, ls.season_year, ll.is_locked as week_is_locked
          FROM lineup_submissions ls
          LEFT JOIN lineup_locks ll ON (ll.week_number = ls.week_number AND ll.season_year = ls.season_year)
          WHERE ls.lineup_id = ?
        `;
        const lockResult = await db.query(lockCheckQuery, [lineupId]);

        if (lockResult.length > 0 && lockResult[0].week_is_locked === 1) {
          // Week is locked - use historical method to show what was actually in the lineup
          return await this.getHistoricalLineupByPosition(lineupId);
        }
      }

      // Build query - only include pending waivers for unlocked weeks
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
          COALESCE(lp.sort_order, 999) as sort_order,
          CASE WHEN lp.position_id IS NOT NULL THEN 1 ELSE 0 END as in_lineup,
          'rostered' as player_status,
          NULL as waiver_request_id
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
      `;

      const pendingWaiversQuery = `
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
          MIN(wr.request_id) as waiver_request_id
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
        GROUP BY p.player_id, p.display_name, p.position, p.first_name, p.last_name,
                 pt.team_name, pt.team_code, lp.sort_order, lp.position_id
      `;

      const orderByClause = `
        ORDER BY position_type,
                 CASE
                   WHEN sort_order IS NOT NULL THEN sort_order
                   WHEN player_status = 'rostered' THEN 1000
                   ELSE 1001
                 END,
                 last_name,
                 first_name
      `;

      // Unlocked weeks include pending waivers (locked weeks return early via getHistoricalLineupByPosition)
      const query = rosterQuery + pendingWaiversQuery + orderByClause;
      const queryParams = [lineupId, teamId, lineupId, teamId];

      const results = await db.query(query, queryParams);
      
      
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
   * Get historical lineup by position (for locked weeks)
   * This method reads stored lineup_positions data to preserve historical accuracy
   * It preserves the actual player_status (e.g., 'pending_waiver') until waivers are processed
   * @param {number} lineupId - The lineup submission ID
   * @returns {Promise<Object>} Object with arrays of players by position
   */
  static async getHistoricalLineupByPosition(lineupId) {
    try {
      const query = `
        SELECT
          lp.*,
          COALESCE(p.display_name, CONCAT('Player ID: ', lp.player_id)) as player_name,
          COALESCE(p.position, 'UNK') as player_position,
          COALESCE(p.first_name, 'Unknown') as first_name,
          COALESCE(p.last_name, 'Player') as last_name,
          COALESCE(nt.team_name, pt.team_name, 'Unknown Team') as nfl_team_name,
          COALESCE(nt.team_code, pt.team_code, 'UNK') as nfl_team_code,
          COALESCE(pt.team_name, nt.team_name, 'Unknown Team') as player_team_name,
          COALESCE(pt.team_code, nt.team_code, 'UNK') as player_team_code,
          COALESCE(nt.team_code, pt.team_code, 'UNK') as team_abbrev,
          lp.position_type,
          1 as in_lineup,
          COALESCE(lp.player_status, 'rostered') as player_status,
          lp.waiver_request_id
        FROM lineup_positions lp
        LEFT JOIN nfl_players p ON lp.player_id = p.player_id
        LEFT JOIN nfl_teams nt ON lp.nfl_team_id = nt.nfl_team_id
        LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
        WHERE lp.lineup_id = ?
        ORDER BY lp.position_type, lp.sort_order
      `;

      const results = await db.query(query, [lineupId]);

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

      return roster;
    } catch (error) {
      console.error('Error fetching historical lineup by position:', error);
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

      // Get the fantasy_team_id for this lineup
      const [lineupInfo] = await connection.query(
        'SELECT fantasy_team_id FROM lineup_submissions WHERE lineup_id = ?',
        [lineupId]
      );
      const fantasyTeamId = lineupInfo[0]?.fantasy_team_id;

      // First, get all pending waiver players to preserve them
      const pendingWaiverQuery = `
        SELECT position_id, player_id, position_type, waiver_request_id, player_status
        FROM lineup_positions
        WHERE lineup_id = ? AND player_status = 'pending_waiver'
      `;
      const [pendingWaivers] = await connection.query(pendingWaiverQuery, [lineupId]);

      // Also get pending waiver player IDs from waiver_requests table
      // (in case they're not yet in lineup_positions with pending_waiver status)
      const [pendingWaiverRequests] = await connection.query(`
        SELECT DISTINCT pickup_player_id
        FROM waiver_requests
        WHERE fantasy_team_id = ? AND status = 'pending'
      `, [fantasyTeamId]);
      const pendingWaiverPlayerIds = new Set([
        ...pendingWaivers.map(pw => pw.player_id),
        ...pendingWaiverRequests.map(pwr => pwr.pickup_player_id)
      ]);

      // Get rostered players for this team
      const [rosteredPlayers] = await connection.query(`
        SELECT player_id FROM fantasy_team_players WHERE fantasy_team_id = ?
      `, [fantasyTeamId]);
      const rosteredPlayerIds = new Set(rosteredPlayers.map(rp => rp.player_id));

      // Delete existing positions for this lineup EXCEPT pending waivers
      await connection.query(
        'DELETE FROM lineup_positions WHERE lineup_id = ? AND (player_status != "pending_waiver" OR player_status IS NULL)',
        [lineupId]
      );

      // Insert new positions (excluding any that are pending waivers)
      for (const position of positions) {
        const { position_type, sort_order } = position;

        // Convert IDs to integers for proper comparison
        // (DOM attributes come as strings, but DB IDs are integers)
        const player_id = position.player_id ? parseInt(position.player_id, 10) : null;
        const nfl_team_id = position.nfl_team_id ? parseInt(position.nfl_team_id, 10) : null;

        // Skip if no player_id
        if (!player_id) {
          continue;
        }

        // Skip if this player_id is a pending waiver (either in lineup_positions or waiver_requests)
        const isPendingWaiver = pendingWaiverPlayerIds.has(player_id);
        if (isPendingWaiver) {
          // Update the sort_order for the pending waiver player if it exists in lineup_positions
          const existsInLineup = pendingWaivers.some(pw => pw.player_id === player_id);
          if (existsInLineup) {
            await connection.query(`
              UPDATE lineup_positions
              SET sort_order = ?, nfl_team_id = ?
              WHERE lineup_id = ? AND player_id = ? AND player_status = 'pending_waiver'
            `, [sort_order, nfl_team_id, lineupId, player_id]);
          }
          // If not in lineup_positions yet, skip - it will be added when the waiver is approved
        } else if (rosteredPlayerIds.has(player_id)) {
          // Only insert if player is actually on the roster
          await connection.query(`
            INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
            sort_order = VALUES(sort_order),
            nfl_team_id = VALUES(nfl_team_id)
          `, [lineupId, position_type, player_id, nfl_team_id, sort_order]);
        } else {
          // Player is neither rostered nor a pending waiver - skip with warning
          console.warn(`Skipping player ${player_id} - not on roster and not a pending waiver for team ${fantasyTeamId}`);
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

  /**
   * Propagate lineup positions to all future unlocked weeks that haven't been user-modified
   * Copies the current week's primary lineup to all future weeks (both primary and bonus)
   * Only includes rostered players (excludes pending_waiver)
   * Only updates weeks where user_modified = 0 (user hasn't manually set that week's lineup)
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {number} currentWeek - The current week number
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object>} Result with weeks updated count
   */
  static async propagateToFutureWeeks(fantasyTeamId, currentWeek, seasonYear = 2025) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get the current week's primary lineup
      const [sourceLineups] = await connection.execute(`
        SELECT lineup_id
        FROM lineup_submissions
        WHERE fantasy_team_id = ?
          AND week_number = ?
          AND game_type = 'primary'
          AND season_year = ?
      `, [fantasyTeamId, currentWeek, seasonYear]);

      if (sourceLineups.length === 0) {
        await connection.rollback();
        return { success: false, message: 'No source lineup found' };
      }

      const sourceLineupId = sourceLineups[0].lineup_id;

      // Get all future unlocked weeks (both primary and bonus) that haven't been user-modified
      // Only get weeks GREATER than current week, not locked, and not user-modified
      const [futureLineups] = await connection.execute(`
        SELECT ls.lineup_id, ls.week_number, ls.game_type
        FROM lineup_submissions ls
        LEFT JOIN lineup_locks ll ON ls.week_number = ll.week_number AND ls.season_year = ll.season_year
        WHERE ls.fantasy_team_id = ?
          AND ls.week_number > ?
          AND ls.week_number <= 17
          AND ls.season_year = ?
          AND (ll.is_locked IS NULL OR ll.is_locked = 0)
          AND (ls.user_modified IS NULL OR ls.user_modified = 0)
        ORDER BY ls.week_number, ls.game_type
      `, [fantasyTeamId, currentWeek, seasonYear]);

      if (futureLineups.length === 0) {
        await connection.commit();
        return { success: true, weeksUpdated: 0, message: 'No future unlocked/unmodified weeks to update' };
      }

      let weeksUpdated = 0;

      for (const targetLineup of futureLineups) {
        // Delete existing positions for the target lineup
        await connection.execute(
          'DELETE FROM lineup_positions WHERE lineup_id = ?',
          [targetLineup.lineup_id]
        );

        // Copy positions from source, only including rostered players
        await connection.execute(`
          INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
          SELECT
            ?,
            lp.position_type,
            lp.player_id,
            lp.nfl_team_id,
            lp.sort_order,
            NOW()
          FROM lineup_positions lp
          JOIN fantasy_team_players ftp ON lp.player_id = ftp.player_id AND ftp.fantasy_team_id = ?
          WHERE lp.lineup_id = ?
            AND (lp.player_status IS NULL OR lp.player_status != 'pending_waiver')
        `, [targetLineup.lineup_id, fantasyTeamId, sourceLineupId]);

        weeksUpdated++;
      }

      await connection.commit();
      console.log(`Propagated lineup for team ${fantasyTeamId} from week ${currentWeek} to ${weeksUpdated} future lineups (skipped user-modified weeks)`);
      return { success: true, weeksUpdated };

    } catch (error) {
      await connection.rollback();
      console.error('Error propagating lineup to future weeks:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Sync roster changes to all future unlocked weeks
   * Adds new players to the bottom of their position, removes dropped players
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {number} currentWeek - The current week number
   * @param {number} addedPlayerId - Player ID that was added (optional)
   * @param {number} droppedPlayerId - Player ID that was dropped (optional)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object>} Result with weeks updated count
   */
  static async syncRosterChangeToFutureWeeks(fantasyTeamId, currentWeek, addedPlayerId = null, droppedPlayerId = null, seasonYear = 2025) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get all future unlocked weeks (both primary and bonus)
      const [futureLineups] = await connection.execute(`
        SELECT ls.lineup_id, ls.week_number, ls.game_type
        FROM lineup_submissions ls
        LEFT JOIN lineup_locks ll ON ls.week_number = ll.week_number AND ls.season_year = ll.season_year
        WHERE ls.fantasy_team_id = ?
          AND ls.week_number > ?
          AND ls.week_number <= 17
          AND ls.season_year = ?
          AND (ll.is_locked IS NULL OR ll.is_locked = 0)
        ORDER BY ls.week_number, ls.game_type
      `, [fantasyTeamId, currentWeek, seasonYear]);

      if (futureLineups.length === 0) {
        await connection.commit();
        return { success: true, weeksUpdated: 0 };
      }

      // Get position type for added player if applicable
      let addedPlayerPositionType = null;
      if (addedPlayerId) {
        const [playerInfo] = await connection.execute(`
          SELECT
            CASE
              WHEN position = 'QB' THEN 'quarterback'
              WHEN position = 'RB' THEN 'running_back'
              WHEN position = 'RC' THEN 'receiver'
              WHEN position = 'PK' THEN 'place_kicker'
              WHEN position = 'DU' THEN 'defense'
              ELSE 'other'
            END as position_type,
            nfl_team_id
          FROM nfl_players
          WHERE player_id = ?
        `, [addedPlayerId]);

        if (playerInfo.length > 0) {
          addedPlayerPositionType = playerInfo[0].position_type;
        }
      }

      let weeksUpdated = 0;

      for (const targetLineup of futureLineups) {
        // Remove dropped player from this lineup
        if (droppedPlayerId) {
          await connection.execute(
            'DELETE FROM lineup_positions WHERE lineup_id = ? AND player_id = ?',
            [targetLineup.lineup_id, droppedPlayerId]
          );
        }

        // Add new player to bottom of their position group (if not already in lineup)
        if (addedPlayerId && addedPlayerPositionType) {
          // Check if player already exists in this lineup
          const [existingPlayer] = await connection.execute(
            'SELECT position_id FROM lineup_positions WHERE lineup_id = ? AND player_id = ?',
            [targetLineup.lineup_id, addedPlayerId]
          );

          if (existingPlayer.length === 0) {
            // Get the next sort order for this position
            const [maxSortResult] = await connection.execute(`
              SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort
              FROM lineup_positions
              WHERE lineup_id = ? AND position_type = ?
            `, [targetLineup.lineup_id, addedPlayerPositionType]);

            const nextSort = maxSortResult[0].next_sort;

            // Get player's nfl_team_id
            const [playerTeam] = await connection.execute(
              'SELECT nfl_team_id FROM nfl_players WHERE player_id = ?',
              [addedPlayerId]
            );
            const nflTeamId = playerTeam.length > 0 ? playerTeam[0].nfl_team_id : null;

            // Insert the new player
            await connection.execute(`
              INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?, NOW())
            `, [targetLineup.lineup_id, addedPlayerPositionType, addedPlayerId, nflTeamId, nextSort]);
          }
        }

        weeksUpdated++;
      }

      await connection.commit();
      console.log(`Synced roster changes for team ${fantasyTeamId} to ${weeksUpdated} future lineups (added: ${addedPlayerId}, dropped: ${droppedPlayerId})`);
      return { success: true, weeksUpdated };

    } catch (error) {
      await connection.rollback();
      console.error('Error syncing roster change to future weeks:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = LineupPosition;