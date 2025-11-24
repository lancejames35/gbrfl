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

}

module.exports = LineupLock;