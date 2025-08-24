/**
 * Timezone Fix Utilities
 * Handles proper date parsing and timezone-aware deadline checking
 */

/**
 * Parse a date string in a specific timezone (defaults to America/Chicago for GBRFL)
 * @param {string} dateString - Date string like '2025-08-24' or '2025-08-24 23:59:59'
 * @param {string} timezone - Target timezone (default: 'America/Chicago')
 * @returns {Date} - Properly timezone-adjusted Date object
 */
function parseDateInTimezone(dateString, timezone = 'America/Chicago') {
  try {
    // If no time is specified, assume end of day (23:59:59)
    let fullDateString = dateString.trim();
    
    // If it's just a date (YYYY-MM-DD), add end of day time
    if (/^\d{4}-\d{2}-\d{2}$/.test(fullDateString)) {
      fullDateString += ' 23:59:59';
    }
    
    // Create date in the specified timezone
    // This creates the date as if it were entered in that timezone
    const tempDate = new Date(fullDateString);
    
    // Get the timezone offset for the target timezone at this date
    const offsetOptions = { timeZone: timezone };
    const utcDate = new Date(tempDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(tempDate.toLocaleString('en-US', offsetOptions));
    const offset = utcDate.getTime() - tzDate.getTime();
    
    // Adjust for timezone
    const adjustedDate = new Date(tempDate.getTime() + offset);
    
    return adjustedDate;
  } catch (error) {
    console.error('Error parsing date in timezone:', error.message);
    return new Date(dateString); // Fallback to regular parsing
  }
}

/**
 * Create a date at end of day in specific timezone
 * @param {string} dateString - Date string like '2025-08-24'
 * @param {string} timezone - Target timezone
 * @returns {Date} - Date set to 11:59:59 PM in the target timezone
 */
function createEndOfDayDate(dateString, timezone = 'America/Chicago') {
  try {
    // Parse just the date part
    const datePart = dateString.split(' ')[0].split('T')[0];
    
    // Create date at end of day in target timezone
    const endOfDayString = `${datePart} 23:59:59`;
    
    // Use Intl API to create date in specific timezone
    const year = parseInt(datePart.split('-')[0]);
    const month = parseInt(datePart.split('-')[1]) - 1; // Month is 0-indexed
    const day = parseInt(datePart.split('-')[2]);
    
    // Create date components in target timezone
    const tzDate = new Date();
    tzDate.setFullYear(year, month, day);
    tzDate.setHours(23, 59, 59, 999);
    
    // Convert to target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(tzDate);
    const tzString = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value} ${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}:${parts.find(p => p.type === 'second').value}`;
    
    return new Date(tzString);
  } catch (error) {
    console.error('Error creating end of day date:', error.message);
    return parseDateInTimezone(dateString + ' 23:59:59', timezone);
  }
}

/**
 * Check if current time is past a deadline, with proper timezone handling
 * @param {string} deadlineString - Deadline date string
 * @param {string} timezone - Timezone for deadline interpretation
 * @returns {Object} - { isPast: boolean, deadline: Date, now: Date, timeRemaining: number }
 */
function checkDeadline(deadlineString, timezone = 'America/Chicago') {
  try {
    const now = new Date();
    const deadline = createEndOfDayDate(deadlineString, timezone);
    
    const timeRemaining = deadline.getTime() - now.getTime();
    const isPast = timeRemaining <= 0;
    
    return {
      isPast,
      deadline,
      now,
      timeRemaining,
      timeRemainingHours: Math.round(timeRemaining / (1000 * 60 * 60)),
      formattedDeadline: deadline.toLocaleString('en-US', { timeZone: timezone }),
      formattedNow: now.toLocaleString('en-US', { timeZone: timezone }),
      timezone
    };
  } catch (error) {
    console.error('Error checking deadline:', error.message);
    return {
      isPast: false,
      error: error.message,
      deadline: null,
      now: new Date(),
      timeRemaining: 0
    };
  }
}

/**
 * Get current time in multiple formats for debugging
 * @param {string} timezone - Target timezone
 * @returns {Object} - Various time representations
 */
function getTimeDebugInfo(timezone = 'America/Chicago') {
  const now = new Date();
  
  return {
    serverTime: {
      iso: now.toISOString(),
      local: now.toString(),
      utc: now.toUTCString(),
      timestamp: now.getTime()
    },
    targetTimezone: {
      name: timezone,
      time: now.toLocaleString('en-US', { timeZone: timezone }),
      date: now.toLocaleDateString('en-US', { timeZone: timezone }),
      timeOnly: now.toLocaleTimeString('en-US', { timeZone: timezone })
    },
    systemTimezone: {
      name: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: now.getTimezoneOffset()
    },
    environment: {
      TZ: process.env.TZ || 'Not set',
      NODE_ENV: process.env.NODE_ENV || 'Not set'
    }
  };
}

module.exports = {
  parseDateInTimezone,
  createEndOfDayDate,
  checkDeadline,
  getTimeDebugInfo
};