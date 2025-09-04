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
      return result.affectedRows > 0;
    } catch (error) {
      // Error setting lock status
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
        // Auto-lock the expired weeks
        for (const week of expiredWeeks) {
          await db.query(`
            UPDATE lineup_locks 
            SET is_locked = 1 
            WHERE week_number = ? AND season_year = ?
          `, [week.week_number, seasonYear]);
        }
      }

      return expiredWeeks;
    } catch (error) {
      // Error auto-locking expired weeks
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