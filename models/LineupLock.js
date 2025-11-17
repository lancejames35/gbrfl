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
          lock_datetime as lock_time
        FROM lineup_locks
        WHERE week_number = ? AND season_year = ?
        LIMIT 1
      `;

      const results = await db.query(query, [weekNumber, seasonYear]);

      let result = results.length > 0 ? results[0] : null;
      let lockDatetime = result?.lock_datetime;
      let isLocked = result?.is_locked === 1;
      let lockSource = result?.lock_datetime ? 'manual' : 'nfl_schedule';

      // If no manual lock time set, fall back to NFL game kickoff time
      if (!lockDatetime && !isLocked) {
        const nflGameQuery = `
          SELECT MIN(kickoff_timestamp) as first_kickoff
          FROM nfl_games
          WHERE week = ? AND season_year = ? AND game_type = 'regular'
        `;
        const nflResults = await db.query(nflGameQuery, [weekNumber, seasonYear]);

        if (nflResults.length > 0 && nflResults[0].first_kickoff) {
          lockDatetime = nflResults[0].first_kickoff;
          lockSource = 'nfl_schedule';
        }
      }

      // Calculate current_status and time until lock in JavaScript with proper timezone handling
      let current_status = 'unlocked';
      let seconds_until_lock = null;
      let minutes_until_lock = null;

      if (isLocked) {
        current_status = 'locked';
      } else if (lockDatetime) {
        // Calculate DST boundaries for proper timezone handling
        const now = new Date();
        const year = seasonYear;
        const marchSecondSunday = new Date(year, 2, 1);
        marchSecondSunday.setDate(1 + (7 - marchSecondSunday.getDay()) % 7 + 7);
        marchSecondSunday.setHours(2, 0, 0, 0);
        const novFirstSunday = new Date(year, 10, 1);
        novFirstSunday.setDate(1 + (7 - novFirstSunday.getDay()) % 7);
        novFirstSunday.setHours(2, 0, 0, 0);

        // Parse lock_datetime with proper Eastern timezone
        const lockDate = new Date(lockDatetime);
        const isDST = lockDate >= marchSecondSunday && lockDate < novFirstSunday;
        const easternTZ = isDST ? 'EDT' : 'EST';
        const lockTimeWithTZ = new Date(lockDatetime + ' ' + easternTZ);

        // Compare with current time
        if (now >= lockTimeWithTZ) {
          current_status = 'auto_locked';
        } else {
          current_status = 'unlocked';
          // Calculate time until lock
          const diffMs = lockTimeWithTZ - now;
          seconds_until_lock = Math.floor(diffMs / 1000);
          minutes_until_lock = Math.floor(diffMs / (1000 * 60));
        }
      }

      return {
        week_number: weekNumber,
        season_year: seasonYear,
        game_type: gameType,
        lock_time: lockDatetime,
        is_locked: isLocked ? 1 : 0,
        current_status,
        seconds_until_lock,
        minutes_until_lock,
        lock_source: lockSource // 'manual' or 'nfl_schedule'
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
      // Get manual lock times from lineup_locks table
      const query = `
        SELECT
          week_number,
          DATE_FORMAT(lock_datetime, '%Y-%m-%d %H:%i:%s') as lock_time,
          is_locked
        FROM lineup_locks
        WHERE season_year = ?
        ORDER BY week_number
      `;

      const results = await db.query(query, [seasonYear]);

      // Get NFL game kickoff times for all weeks
      const nflGamesQuery = `
        SELECT
          week,
          MIN(kickoff_timestamp) as first_kickoff
        FROM nfl_games
        WHERE season_year = ? AND game_type = 'regular'
        GROUP BY week
        ORDER BY week
      `;
      const nflGames = await db.query(nflGamesQuery, [seasonYear]);

      // Create a map of week -> kickoff time
      const nflKickoffMap = {};
      nflGames.forEach(game => {
        nflKickoffMap[game.week] = game.first_kickoff;
      });

      // Create a map of manually set lock times
      const manualLockMap = {};
      results.forEach(lock => {
        manualLockMap[lock.week_number] = lock;
      });

      // Calculate DST boundaries for the season
      const year = seasonYear;
      const marchSecondSunday = new Date(year, 2, 1);
      marchSecondSunday.setDate(1 + (7 - marchSecondSunday.getDay()) % 7 + 7);
      marchSecondSunday.setHours(2, 0, 0, 0);
      const novFirstSunday = new Date(year, 10, 1);
      novFirstSunday.setDate(1 + (7 - novFirstSunday.getDay()) % 7);
      novFirstSunday.setHours(2, 0, 0, 0);

      const now = new Date();

      // Build result for all 18 weeks
      const allWeeks = [];
      for (let weekNum = 1; weekNum <= 18; weekNum++) {
        const manualLock = manualLockMap[weekNum];
        const nflKickoff = nflKickoffMap[weekNum];

        let lockDatetime = manualLock?.lock_time || nflKickoff;
        let isLocked = manualLock?.is_locked === 1;
        let lockSource = manualLock?.lock_time ? 'manual' : 'nfl_schedule';

        // Calculate current_status and time until lock
        let current_status = 'unlocked';
        let minutes_until_lock = null;
        let seconds_until_lock = null;
        let lock_time_iso = null;

        if (isLocked) {
          current_status = 'locked';
        } else if (lockDatetime) {
          // Parse the stored time and check if it was during DST
          const storedDate = new Date(lockDatetime);
          const isDST = storedDate >= marchSecondSunday && storedDate < novFirstSunday;
          const easternTZ = isDST ? 'EDT' : 'EST';

          // Parse with proper Eastern timezone and convert to ISO
          const lockTimeWithTZ = new Date(lockDatetime + ' ' + easternTZ);
          lock_time_iso = lockTimeWithTZ.toISOString();

          // Compare with current time to determine status and calculate countdown
          if (now >= lockTimeWithTZ) {
            current_status = 'auto_locked';
          } else {
            current_status = 'unlocked';
            // Calculate time until lock
            const diffMs = lockTimeWithTZ - now;
            seconds_until_lock = Math.floor(diffMs / 1000);
            minutes_until_lock = Math.floor(diffMs / (1000 * 60));
          }
        }

        allWeeks.push({
          week_number: weekNum,
          lock_time: lock_time_iso,
          is_locked: isLocked ? 1 : 0,
          current_status,
          minutes_until_lock,
          seconds_until_lock,
          lock_source: lockSource // 'manual' or 'nfl_schedule'
        });
      }

      return allWeeks;
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
   * Uses the same timezone logic as the frontend to ensure consistency
   * @param {number} seasonYear - The season year
   * @returns {Promise<Array>} Array of weeks that were auto-locked
   */
  static async autoLockExpiredWeeks(seasonYear = 2025) {
    try {
      const expiredWeeks = [];

      // Get all weeks with lock times set but not yet manually locked
      const weeks = await db.query(`
        SELECT week_number
        FROM lineup_locks
        WHERE season_year = ?
          AND lock_datetime IS NOT NULL
          AND is_locked = 0
      `, [seasonYear]);

      // Check each week using the SAME logic as the frontend
      for (const week of weeks) {
        const lockStatus = await this.getLockStatus(week.week_number, 'primary', seasonYear);

        // If the frontend would show it as auto_locked, process it
        if (lockStatus.current_status === 'auto_locked') {
          console.log(`Auto-locking Week ${week.week_number}, Season ${seasonYear}`);

          await db.query(`
            UPDATE lineup_locks
            SET is_locked = 1
            WHERE week_number = ? AND season_year = ?
          `, [week.week_number, seasonYear]);

          // Populate empty lineups from previous week
          await this.populateEmptyLineupsFromPrevious(week.week_number, seasonYear);
          expiredWeeks.push(week);
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

      // Get all active fantasy teams
      const teamsQuery = `
        SELECT team_id, team_name
        FROM fantasy_teams
        WHERE is_active = 1
      `;
      const teams = await db.query(teamsQuery);
      console.log(`Found ${teams.length} active fantasy teams`);

      // Get game types for this week from weekly_schedule
      const scheduleQuery = `
        SELECT DISTINCT game_type
        FROM weekly_schedule
        WHERE week_number = ? AND season_year = ?
      `;
      const gameTypes = await db.query(scheduleQuery, [weekNumber, seasonYear]);
      console.log(`Found ${gameTypes.length} game type(s) for Week ${weekNumber}: ${gameTypes.map(g => g.game_type).join(', ')}`);

      // If no schedule exists, default to primary only
      const gameTypesToProcess = gameTypes.length > 0
        ? gameTypes.map(g => g.game_type)
        : ['primary'];

      let populated = 0;
      let skipped = 0;
      let created = 0;

      // Process each team + game_type combination
      for (const team of teams) {
        for (const gameType of gameTypesToProcess) {
          // Check if lineup_submission exists, create if not
          let lineupQuery = `
            SELECT lineup_id, fantasy_team_id, week_number, game_type, season_year
            FROM lineup_submissions
            WHERE fantasy_team_id = ?
              AND week_number = ?
              AND game_type = ?
              AND season_year = ?
          `;

          let lineupResult = await db.query(lineupQuery, [team.team_id, weekNumber, gameType, seasonYear]);

          let lineup;
          if (lineupResult.length === 0) {
            // Create the lineup_submission
            console.log(`Creating lineup_submission for Team ${team.team_id} (${team.team_name}), Week ${weekNumber}, ${gameType}`);
            const insertResult = await db.query(`
              INSERT INTO lineup_submissions (fantasy_team_id, week_number, game_type, season_year, created_at)
              VALUES (?, ?, ?, ?, NOW())
            `, [team.team_id, weekNumber, gameType, seasonYear]);

            lineup = {
              lineup_id: insertResult.insertId,
              fantasy_team_id: team.team_id,
              week_number: weekNumber,
              game_type: gameType,
              season_year: seasonYear
            };
            created++;
          } else {
            lineup = lineupResult[0];
          }

          // Check if this lineup already has saved positions (excluding pending waivers)
          // We only count regular saved positions - pending waivers don't count as "user saved"
          const existingPositions = await db.query(
            'SELECT COUNT(*) as count FROM lineup_positions WHERE lineup_id = ? AND (player_status IS NULL OR player_status != \'pending_waiver\')',
            [lineup.lineup_id]
          );

          if (existingPositions[0].count > 0) {
            console.log(`Lineup ${lineup.lineup_id} (Team ${team.team_id}, ${gameType}) already has ${existingPositions[0].count} saved positions, skipping`);
            skipped++;
            continue;
          }

          console.log(`Populating lineup ${lineup.lineup_id} (Team ${team.team_id}, ${gameType})`);

          // Always look for previous week's PRIMARY lineup as the source
          const previousLineup = await this.findPreviousLineupWithPositions(
            lineup.fantasy_team_id,
            lineup.week_number,
            'primary', // Always use primary as source
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
      }

      return {
        total: teams.length * gameTypesToProcess.length,
        created,
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