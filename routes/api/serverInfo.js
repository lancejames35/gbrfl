/**
 * Server Information API Routes
 * Provides server timezone and time information for debugging
 */

const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { checkDeadline, getTimeDebugInfo } = require('../../utils/timezoneFix');
const WeekStatus = require('../../models/WeekStatus');

/**
 * Get server time and timezone information
 * @route GET /api/server-time
 * @access Public (for debugging)
 */
router.get('/server-time', async (req, res) => {
  try {
    const now = new Date();
    
    // Get database timezone
    let dbTimezone = 'Unknown';
    let dbTime = null;
    
    try {
      const dbResult = await db.query('SELECT NOW() as db_time, @@session.time_zone as tz, @@global.time_zone as global_tz');
      if (dbResult && dbResult[0]) {
        dbTime = dbResult[0].db_time;
        dbTimezone = dbResult[0].tz === 'SYSTEM' ? `SYSTEM (${dbResult[0].global_tz})` : dbResult[0].tz;
      }
    } catch (dbError) {
      // Error fetching database timezone
      // Fallback to basic NOW() query
      try {
        const fallbackResult = await db.query('SELECT NOW() as db_time');
        if (fallbackResult && fallbackResult[0]) {
          dbTime = fallbackResult[0].db_time;
          dbTimezone = 'Unable to determine (using fallback)';
        }
      } catch (fallbackError) {
        // Fallback query also failed
      }
    }

    // Get system timezone
    const systemTimezone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    
    // Get various time representations
    const timeInfo = {
      serverTime: now.toISOString(),
      serverTimezone: systemTimezone,
      serverLocalTime: now.toLocaleString(),
      
      // Database info
      databaseTime: dbTime,
      databaseTimezone: dbTimezone,
      
      // Environment info
      nodeEnv: process.env.NODE_ENV || 'development',
      tzEnvironment: process.env.TZ || 'Not set',
      
      // System info
      platform: process.platform,
      
      // Timestamps for comparison
      unixTimestamp: Math.floor(now.getTime() / 1000),
      isoString: now.toISOString(),
      
      // Different timezone representations
      utcTime: now.toUTCString(),
      localTime: now.toString(),
      
      // Offset information
      timezoneOffset: now.getTimezoneOffset(), // minutes from UTC
      timezoneOffsetString: `UTC${now.getTimezoneOffset() <= 0 ? '+' : '-'}${Math.abs(Math.floor(now.getTimezoneOffset() / 60)).toString().padStart(2, '0')}:${Math.abs(now.getTimezoneOffset() % 60).toString().padStart(2, '0')}`
    };

    res.json(timeInfo);
  } catch (error) {
    // Server time API error
    res.status(500).json({ error: 'Failed to get server time information' });
  }
});

/**
 * Get league settings related to time/deadlines
 * @route GET /api/league-time-settings
 * @access Private (admins only)
 */
router.get('/league-time-settings', async (req, res) => {
  try {
    // Get league settings that involve dates/times
    const settings = await db.query(`
      SELECT 
        setting_key,
        setting_value,
        description,
        updated_at
      FROM league_settings 
      WHERE setting_key LIKE '%date%' 
        OR setting_key LIKE '%time%' 
        OR setting_key LIKE '%deadline%'
      ORDER BY setting_key
    `);
    
    // Get current time comparisons for each deadline
    const now = new Date();
    const processedSettings = settings.map(setting => {
      const value = setting.setting_value;
      let analysis = null;
      
      // Try to parse as date
      if (value && (value.includes('-') || value.includes('/'))) {
        try {
          const settingDate = new Date(value);
          if (!isNaN(settingDate.getTime())) {
            const timeDiff = settingDate.getTime() - now.getTime();
            const daysDiff = Math.round(timeDiff / (1000 * 60 * 60 * 24));
            const hoursDiff = Math.round(timeDiff / (1000 * 60 * 60));
            
            analysis = {
              parsedDate: settingDate.toISOString(),
              localDate: settingDate.toLocaleString(),
              timeDifference: timeDiff,
              daysDifference: daysDiff,
              hoursDifference: hoursDiff,
              isPast: timeDiff < 0,
              isFuture: timeDiff > 0,
              status: timeDiff < 0 ? 'PASSED' : (daysDiff <= 1 ? 'URGENT' : 'FUTURE')
            };
          }
        } catch (dateError) {
          analysis = { error: 'Could not parse as date' };
        }
      }
      
      return {
        ...setting,
        analysis
      };
    });
    
    res.json({
      currentTime: now.toISOString(),
      settings: processedSettings
    });
    
  } catch (error) {
    // League time settings API error
    res.status(500).json({ error: 'Failed to get league time settings' });
  }
});

/**
 * Timezone diagnostic endpoint for debugging deadline issues
 * @route GET /api/timezone-debug
 * @access Public (for debugging)
 */
router.get('/timezone-debug', async (req, res) => {
  try {
    const debugInfo = getTimeDebugInfo('America/Chicago');
    
    // Test the keeper deadline if provided
    let keeperTest = null;
    const testDeadline = req.query.deadline || '2025-08-24';
    
    if (testDeadline) {
      keeperTest = checkDeadline(testDeadline, 'America/Chicago');
    }

    // Get league settings from database if available
    let leagueSettings = null;
    try {
      const settings = await db.query(`
        SELECT setting_key, setting_value, description 
        FROM league_settings 
        WHERE setting_key LIKE '%deadline%' OR setting_key LIKE '%date%'
        ORDER BY setting_key
      `);
      leagueSettings = settings;
    } catch (dbError) {
      leagueSettings = { error: 'Database not available: ' + dbError.message };
    }

    res.json({
      debugInfo,
      keeperDeadlineTest: keeperTest,
      leagueSettings,
      explanation: {
        problem: "Dates stored as 'YYYY-MM-DD' are interpreted as UTC midnight, which is 7PM CDT the previous day",
        solution: "Use timezone-aware date parsing to interpret '2025-08-24' as end of day in Chicago time",
        example: `'2025-08-24' should mean '2025-08-24 23:59:59 CDT' not '2025-08-24 00:00:00 UTC'`
      }
    });
  } catch (error) {
    // Timezone debug error
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get the next lineup lock time
 * @route GET /api/next-lineup-lock
 * @access Public
 */
router.get('/next-lineup-lock', async (req, res) => {
  try {
    // Get current week number using NFL game data
    let currentWeek;
    try {
      currentWeek = await WeekStatus.getCurrentWeek();
    } catch (weekError) {
      console.error('Error getting current week, falling back to week 1:', weekError);
      currentWeek = 1;
    }
    const seasonYear = 2025;
    
    // First check if we have a manual override in lineup_locks table
    const manualLock = await db.query(`
      SELECT week_number, lock_datetime, is_locked
      FROM lineup_locks
      WHERE season_year = ?
      AND week_number >= ?
      AND lock_datetime IS NOT NULL
      ORDER BY week_number ASC
      LIMIT 1
    `, [seasonYear, currentWeek]);
    
    if (manualLock && manualLock[0]) {
      // Use manual lock time if available
      res.json({
        success: true,
        weekNumber: manualLock[0].week_number,
        lockTime: manualLock[0].lock_datetime,
        isLocked: manualLock[0].is_locked === 1
      });
      return;
    }
    
    // Calculate deadline dynamically from NFL games
    const nextWeekGames = await db.query(`
      SELECT 
        week,
        MIN(kickoff_timestamp) as first_kickoff
      FROM nfl_games 
      WHERE season_year = ? 
      AND game_type = 'regular'
      AND week >= ?
      GROUP BY week
      ORDER BY week ASC
      LIMIT 1
    `, [seasonYear, currentWeek]);
    
    if (nextWeekGames && nextWeekGames[0]) {
      const week = nextWeekGames[0].week;
      const firstKickoff = new Date(nextWeekGames[0].first_kickoff);
      
      // Calculate Thursday deadline before the first game at 7:20 PM ET
      const lockDatetime = new Date(firstKickoff);
      const dayOfWeek = firstKickoff.getDay(); // 0 = Sunday, 4 = Thursday
      const daysToSubtract = dayOfWeek === 0 ? 3 : (dayOfWeek + 3) % 7; // Days to go back to Thursday
      lockDatetime.setDate(firstKickoff.getDate() - daysToSubtract);
      lockDatetime.setHours(23, 20, 0, 0); // 7:20 PM ET (23:20 UTC)
      
      // Check if this deadline has already passed
      const now = new Date();
      const isLocked = now > lockDatetime;
      
      res.json({
        success: true,
        weekNumber: week,
        lockTime: lockDatetime.toISOString(),
        isLocked: isLocked
      });
    } else {
      // No future games found
      res.json({
        success: true,
        weekNumber: currentWeek,
        lockTime: null,
        isLocked: false
      });
    }
  } catch (error) {
    console.error('Error fetching next lineup lock:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch lineup lock time' 
    });
  }
});

module.exports = router;