const db = require('../config/database');

class LineupLock {
  /**
   * Get lock status for a specific week 
   * @param {number} weekNumber - The week number (1-17)
   * @param {string} gameType - 'primary' or 'bonus' (ignored, kept for compatibility)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object>} Lock status information
   */
  static async getLockStatus(weekNumber, gameType = 'primary', seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          *,
          lock_datetime as lock_time,
          CASE 
            WHEN is_locked = 1 THEN 'locked'
            WHEN lock_datetime IS NULL THEN 'unlocked'
            WHEN NOW() >= lock_datetime THEN 'auto_locked'
            ELSE 'unlocked'
          END as current_status,
          null as seconds_until_lock,
          null as minutes_until_lock
        FROM lineup_locks 
        WHERE week_number = ? AND season_year = ?
        LIMIT 1
      `;

      const results = await db.query(query, [weekNumber, seasonYear]);
      
      if (results.length === 0) {
        return {
          week_number: weekNumber,
          game_type: gameType, // Return for compatibility
          season_year: seasonYear,
          lock_time: null,
          is_locked: 0,
          current_status: 'unlocked',
          seconds_until_lock: null,
          minutes_until_lock: null
        };
      }

      const result = results[0];
      
      return {
        ...result,
        game_type: gameType // Add for compatibility
      };
    } catch (error) {
      // Error fetching lock status
      throw error;
    }
  }

  /**
   * Set lock time for a specific week
   * @param {number} weekNumber - The week number
   * @param {number} seasonYear - The season year
   * @param {Date} lockTime - The lock time
   * @returns {Promise<boolean>} Success status
   */
  static async setLockTime(weekNumber, seasonYear, lockTime) {
    try {
      const query = `
        INSERT INTO lineup_locks (week_number, season_year, lock_datetime, is_locked) 
        VALUES (?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE 
        lock_datetime = VALUES(lock_datetime),
        is_locked = VALUES(is_locked)
      `;

      const result = await db.query(query, [weekNumber, seasonYear, lockTime]);
      return result.affectedRows > 0;
    } catch (error) {
      // Error setting lock time
      throw error;
    }
  }

  /**
   * Manually lock/unlock a week
   * @param {number} weekNumber - The week number
   * @param {number} seasonYear - The season year
   * @param {boolean} isLocked - Lock status
   * @returns {Promise<boolean>} Success status
   */
  static async setLockStatus(weekNumber, seasonYear, isLocked) {
    try {
      // When manually toggling, set lock_datetime to current time if locking, or a default future time if unlocking
      const currentTime = new Date();
      const lockDatetime = isLocked ? currentTime : new Date('2025-12-31 23:59:59'); // Default future time for unlocked state

      const query = `
        INSERT INTO lineup_locks (week_number, season_year, is_locked, lock_datetime)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        is_locked = VALUES(is_locked),
        lock_datetime = CASE
          WHEN VALUES(is_locked) = 1 THEN NOW()
          ELSE lock_datetime
        END
      `;

      const result = await db.query(query, [weekNumber, seasonYear, isLocked ? 1 : 0, lockDatetime]);

      // If locking the week, populate empty lineups from previous week
      if (isLocked) {
        console.log(`Manually locking Week ${weekNumber}, Season ${seasonYear}`);
        await this.populateEmptyLineupsFromPrevious(weekNumber, seasonYear);
      }

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error setting lock status:', error);
      throw error;
    }
  }

  /**
   * Get all weeks lock status for a season
   * @param {number} seasonYear - The season year
   * @returns {Promise<Array>} Array of lock statuses
   */
  static async getAllWeeksStatus(seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          week_number,
          lock_datetime as lock_time,
          is_locked,
          CASE 
            WHEN is_locked = 1 THEN 'locked'
            WHEN lock_datetime IS NULL THEN 'unlocked'
            WHEN NOW() >= lock_datetime THEN 'auto_locked'
            ELSE 'unlocked'
          END as current_status,
          null as minutes_until_lock
        FROM lineup_locks 
        WHERE season_year = ?
        ORDER BY week_number
      `;

      const results = await db.query(query, [seasonYear]);
      return results;
    } catch (error) {
      // Error fetching all weeks status
      throw error;
    }
  }

  /**
   * Get upcoming locks within specified hours
   * @param {number} hoursAhead - Hours to look ahead
   * @param {number} seasonYear - The season year
   * @returns {Promise<Array>} Array of upcoming locks
   */
  static async getUpcomingLocks(hoursAhead = 24, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          week_number,
          lock_datetime as lock_time,
          null as minutes_until_lock,
          null as hours_until_lock
        FROM lineup_locks 
        WHERE season_year = ?
        AND lock_datetime IS NOT NULL 
        AND lock_datetime > NOW() 
        AND lock_datetime <= DATE_ADD(NOW(), INTERVAL ? HOUR)
        AND is_locked = 0
        ORDER BY lock_datetime
      `;

      const results = await db.query(query, [seasonYear, hoursAhead]);
      return results;
    } catch (error) {
      // Error fetching upcoming locks
      throw error;
    }
  }

  /**
   * Auto-lock weeks that have passed their lock time
   * @param {number} seasonYear - The season year
   * @returns {Promise<Array>} Array of weeks that were auto-locked
   */
  static async autoLockExpiredWeeks(seasonYear = 2025) {
    try {
      // First, get weeks that should be auto-locked
      const selectQuery = `
        SELECT week_number, lock_datetime as lock_time
        FROM lineup_locks
        WHERE season_year = ?
        AND lock_datetime IS NOT NULL
        AND NOW() >= lock_datetime
        AND is_locked = 0
      `;

      const expiredWeeks = await db.query(selectQuery, [seasonYear]);

      if (expiredWeeks.length > 0) {
        // Auto-lock the expired weeks and populate empty lineups
        for (const week of expiredWeeks) {
          console.log(`Auto-locking Week ${week.week_number}, Season ${seasonYear}`);

          await db.query(`
            UPDATE lineup_locks
            SET is_locked = 1
            WHERE week_number = ? AND season_year = ?
          `, [week.week_number, seasonYear]);

          // Populate empty lineups from previous week
          await this.populateEmptyLineupsFromPrevious(week.week_number, seasonYear);
        }
      }

      return expiredWeeks;
    } catch (error) {
      console.error('Error auto-locking expired weeks:', error);
      throw error;
    }
  }

  /**
   * Check if a specific week is locked
   * @param {number} weekNumber - The week number
   * @param {number} seasonYear - The season year
   * @returns {Promise<boolean>} Whether the week is locked
   */
  static async isWeekLocked(weekNumber, seasonYear = 2025) {
    try {
      const query = `
        SELECT
          CASE
            WHEN is_locked = 1 THEN 1
            WHEN lock_datetime IS NOT NULL AND NOW() >= lock_datetime THEN 1
            ELSE 0
          END as is_locked
        FROM lineup_locks
        WHERE week_number = ? AND season_year = ?
      `;

      const results = await db.query(query, [weekNumber, seasonYear]);

      if (results.length === 0) {
        return false; // No lock record means unlocked
      }

      return results[0].is_locked === 1;
    } catch (error) {
      // Error checking if week is locked
      throw error;
    }
  }

  /**
   * Populate empty lineups from previous week when locking
   * For any lineup submission with no saved positions, copy from previous week's lineup
   * or fall back to alphabetical order by position
   * @param {number} weekNumber - The week number being locked
   * @param {number} seasonYear - The season year
   * @returns {Promise<Object>} Summary of populated lineups
   */
  static async populateEmptyLineupsFromPrevious(weekNumber, seasonYear = 2025) {
    try {
      console.log(`Populating empty lineups for Week ${weekNumber}, Season ${seasonYear}`);

      // Get all lineup submissions for this week
      const lineupsQuery = `
        SELECT ls.lineup_id, ls.fantasy_team_id, ls.week_number, ls.game_type, ls.season_year
        FROM lineup_submissions ls
        WHERE ls.week_number = ? AND ls.season_year = ?
      `;

      const lineups = await db.query(lineupsQuery, [weekNumber, seasonYear]);
      console.log(`Found ${lineups.length} lineup submissions for Week ${weekNumber}`);

      let populated = 0;
      let skipped = 0;

      for (const lineup of lineups) {
        // Check if this lineup already has saved positions (excluding pending waivers)
        // We only count regular saved positions - pending waivers don't count as "user saved"
        const existingPositions = await db.query(
          'SELECT COUNT(*) as count FROM lineup_positions WHERE lineup_id = ? AND (player_status IS NULL OR player_status != \'pending_waiver\')',
          [lineup.lineup_id]
        );

        if (existingPositions[0].count > 0) {
          console.log(`Lineup ${lineup.lineup_id} already has ${existingPositions[0].count} saved positions, skipping`);
          skipped++;
          continue;
        }

        console.log(`Populating lineup ${lineup.lineup_id} (Team ${lineup.fantasy_team_id}, ${lineup.game_type})`);

        // Find the most recent previous lineup with saved positions
        const previousLineup = await this.findPreviousLineupWithPositions(
          lineup.fantasy_team_id,
          lineup.week_number,
          lineup.game_type,
          lineup.season_year
        );

        if (previousLineup) {
          console.log(`Found previous lineup: ${previousLineup.lineup_id} from Week ${previousLineup.week_number}`);
          await this.copyLineupWithNewPlayerHandling(previousLineup.lineup_id, lineup.lineup_id, lineup.fantasy_team_id);
          populated++;
        } else {
          console.log(`No previous lineup found, using alphabetical order`);
          await this.createAlphabeticalLineup(lineup.lineup_id, lineup.fantasy_team_id);
          populated++;
        }
      }

      return {
        total: lineups.length,
        populated,
        skipped
      };
    } catch (error) {
      console.error('Error populating empty lineups:', error);
      throw error;
    }
  }

  /**
   * Find the most recent previous lineup with saved positions for a team
   * @param {number} fantasyTeamId - The fantasy team ID
   * @param {number} currentWeek - The current week number
   * @param {string} gameType - The game type ('primary' or 'bonus')
   * @param {number} seasonYear - The season year
   * @returns {Promise<Object|null>} Previous lineup or null
   */
  static async findPreviousLineupWithPositions(fantasyTeamId, currentWeek, gameType, seasonYear) {
    try {
      // Search backwards from currentWeek - 1 to week 1
      for (let week = currentWeek - 1; week >= 1; week--) {
        // First try to find same game type
        let query = `
          SELECT ls.lineup_id, ls.week_number, ls.game_type, COUNT(lp.position_id) as position_count
          FROM lineup_submissions ls
          JOIN lineup_positions lp ON ls.lineup_id = lp.lineup_id
          WHERE ls.fantasy_team_id = ?
            AND ls.week_number = ?
            AND ls.game_type = ?
            AND ls.season_year = ?
          GROUP BY ls.lineup_id, ls.week_number, ls.game_type
          HAVING position_count > 0
          LIMIT 1
        `;

        let results = await db.query(query, [fantasyTeamId, week, gameType, seasonYear]);

        if (results.length > 0) {
          return results[0];
        }

        // If bonus game and no previous bonus found, try primary
        if (gameType === 'bonus') {
          query = `
            SELECT ls.lineup_id, ls.week_number, ls.game_type, COUNT(lp.position_id) as position_count
            FROM lineup_submissions ls
            JOIN lineup_positions lp ON ls.lineup_id = lp.lineup_id
            WHERE ls.fantasy_team_id = ?
              AND ls.week_number = ?
              AND ls.game_type = 'primary'
              AND ls.season_year = ?
            GROUP BY ls.lineup_id, ls.week_number, ls.game_type
            HAVING position_count > 0
            LIMIT 1
          `;

          results = await db.query(query, [fantasyTeamId, week, seasonYear]);

          if (results.length > 0) {
            return results[0];
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding previous lineup:', error);
      throw error;
    }
  }

  /**
   * Copy lineup from previous week, handling new/removed players
   * @param {number} sourceLineupId - Source lineup ID
   * @param {number} targetLineupId - Target lineup ID
   * @param {number} fantasyTeamId - Fantasy team ID
   * @returns {Promise<boolean>} Success status
   */
  static async copyLineupWithNewPlayerHandling(sourceLineupId, targetLineupId, fantasyTeamId) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get current roster for the team
      const currentRosterQuery = `
        SELECT ftp.player_id, p.position
        FROM fantasy_team_players ftp
        JOIN nfl_players p ON ftp.player_id = p.player_id
        WHERE ftp.fantasy_team_id = ?
        AND p.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
      `;

      const currentRoster = await connection.query(currentRosterQuery, [fantasyTeamId]);
      const currentRosterIds = new Set(currentRoster.map(p => p.player_id));

      // Get positions from previous lineup (excluding pending waivers - they're week-specific)
      const previousPositionsQuery = `
        SELECT lp.player_id, lp.position_type, lp.sort_order, lp.nfl_team_id, p.position
        FROM lineup_positions lp
        LEFT JOIN nfl_players p ON lp.player_id = p.player_id
        WHERE lp.lineup_id = ?
        AND (lp.player_status IS NULL OR lp.player_status != 'pending_waiver')
        ORDER BY lp.position_type, lp.sort_order
      `;

      const previousPositions = await connection.query(previousPositionsQuery, [sourceLineupId]);

      // Group by position type
      const positionGroups = {
        quarterback: [],
        running_back: [],
        receiver: [],
        place_kicker: [],
        defense: []
      };

      // Add players from previous lineup that are still on roster
      for (const pos of previousPositions) {
        if (currentRosterIds.has(pos.player_id)) {
          positionGroups[pos.position_type].push(pos);
        }
      }

      // Find new players (on current roster but not in previous lineup)
      const previousPlayerIds = new Set(previousPositions.map(p => p.player_id));
      const newPlayers = currentRoster.filter(p => !previousPlayerIds.has(p.player_id));

      // Map position to position_type
      const positionTypeMap = {
        'QB': 'quarterback',
        'RB': 'running_back',
        'RC': 'receiver',
        'PK': 'place_kicker',
        'DU': 'defense'
      };

      // Add new players to the end of their position groups
      for (const newPlayer of newPlayers) {
        const posType = positionTypeMap[newPlayer.position];
        if (posType && positionGroups[posType]) {
          // Get NFL team ID for this player
          const nflTeamQuery = `SELECT nfl_team_id FROM nfl_players WHERE player_id = ?`;
          const nflTeamResult = await connection.query(nflTeamQuery, [newPlayer.player_id]);
          const nflTeamId = nflTeamResult[0]?.nfl_team_id || null;

          // Calculate next sort_order for this position type
          const maxSortOrder = positionGroups[posType].length > 0
            ? Math.max(...positionGroups[posType].map(p => p.sort_order))
            : 0;

          positionGroups[posType].push({
            player_id: newPlayer.player_id,
            position_type: posType,
            sort_order: maxSortOrder + 1,
            nfl_team_id: nflTeamId,
            position: newPlayer.position
          });
        }
      }

      // Insert all positions into target lineup
      for (const posType in positionGroups) {
        for (const pos of positionGroups[posType]) {
          await connection.query(`
            INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
          `, [targetLineupId, pos.position_type, pos.player_id, pos.nfl_team_id, pos.sort_order]);
        }
      }

      // NOTE: We do NOT copy pending waiver players from source
      // Pending waivers are week-specific and are automatically added by the waiver system
      // The target week would already have its own pending waivers if applicable

      await connection.commit();
      console.log(`Successfully copied lineup ${sourceLineupId} to ${targetLineupId} with new player handling`);
      return true;
    } catch (error) {
      await connection.rollback();
      console.error('Error copying lineup with new player handling:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Create lineup in alphabetical order by position (fallback when no previous lineup exists)
   * @param {number} lineupId - Lineup ID to populate
   * @param {number} fantasyTeamId - Fantasy team ID
   * @returns {Promise<boolean>} Success status
   */
  static async createAlphabeticalLineup(lineupId, fantasyTeamId) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get all rostered players ordered alphabetically by position
      const rosterQuery = `
        SELECT
          ftp.player_id,
          p.position,
          p.nfl_team_id,
          p.last_name,
          p.first_name,
          CASE
            WHEN p.position = 'QB' THEN 'quarterback'
            WHEN p.position = 'RB' THEN 'running_back'
            WHEN p.position = 'RC' THEN 'receiver'
            WHEN p.position = 'PK' THEN 'place_kicker'
            WHEN p.position = 'DU' THEN 'defense'
          END as position_type
        FROM fantasy_team_players ftp
        JOIN nfl_players p ON ftp.player_id = p.player_id
        WHERE ftp.fantasy_team_id = ?
        AND p.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
        ORDER BY
          FIELD(p.position, 'QB', 'RB', 'RC', 'PK', 'DU'),
          p.last_name,
          p.first_name
      `;

      const roster = await connection.query(rosterQuery, [fantasyTeamId]);

      // Group by position and assign sort_order
      const positionCounts = {
        quarterback: 0,
        running_back: 0,
        receiver: 0,
        place_kicker: 0,
        defense: 0
      };

      for (const player of roster) {
        if (player.position_type) {
          positionCounts[player.position_type]++;
          const sortOrder = positionCounts[player.position_type];

          await connection.query(`
            INSERT INTO lineup_positions (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
          `, [lineupId, player.position_type, player.player_id, player.nfl_team_id, sortOrder]);
        }
      }

      await connection.commit();
      console.log(`Successfully created alphabetical lineup for lineup ${lineupId}`);
      return true;
    } catch (error) {
      await connection.rollback();
      console.error('Error creating alphabetical lineup:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = LineupLock;