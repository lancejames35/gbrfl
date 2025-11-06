const db = require('../config/database');

class WeekStatus {
  /**
   * Get the status of a specific week based on NFL game data
   * @param {number} weekNumber - The week number (1-18)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object>} Week status information
   */
  static async getWeekStatus(weekNumber, seasonYear = 2025) {
    try {
      // Get the latest kickoff time for this week
      const gameData = await db.query(`
        SELECT 
          MIN(kickoff_timestamp) as first_kickoff_time,
          MAX(kickoff_timestamp) as last_kickoff_time
        FROM nfl_games 
        WHERE week = ? AND season_year = ? AND game_type = 'regular'
      `, [weekNumber, seasonYear]);
      
      if (!gameData[0] || !gameData[0].first_kickoff_time) {
        return {
          week_number: weekNumber,
          season_year: seasonYear,
          status: 'unknown',
          first_kickoff_time: null,
          last_kickoff_time: null
        };
      }
      
      const data = gameData[0];
      const now = new Date();

      // Calculate DST boundaries for proper timezone handling
      const year = seasonYear;
      const marchSecondSunday = new Date(year, 2, 1);
      marchSecondSunday.setDate(1 + (7 - marchSecondSunday.getDay()) % 7 + 7);
      marchSecondSunday.setHours(2, 0, 0, 0);
      const novFirstSunday = new Date(year, 10, 1);
      novFirstSunday.setDate(1 + (7 - novFirstSunday.getDay()) % 7);
      novFirstSunday.setHours(2, 0, 0, 0);

      // Parse kickoff times with proper Eastern timezone
      const firstKickoffDate = new Date(data.first_kickoff_time);
      const isDSTFirst = firstKickoffDate >= marchSecondSunday && firstKickoffDate < novFirstSunday;
      const firstTZ = isDSTFirst ? 'EDT' : 'EST';
      const weekStartTime = new Date(data.first_kickoff_time + ' ' + firstTZ);

      const lastKickoffDate = new Date(data.last_kickoff_time);
      const isDSTLast = lastKickoffDate >= marchSecondSunday && lastKickoffDate < novFirstSunday;
      const lastTZ = isDSTLast ? 'EDT' : 'EST';
      const weekEndTime = new Date(data.last_kickoff_time + ' ' + lastTZ);

      let status;
      if (now < weekStartTime) {
        status = 'upcoming';
      } else if (now > weekEndTime) {
        status = 'completed';
      } else {
        status = 'live';
      }
      
      return {
        week_number: weekNumber,
        season_year: seasonYear,
        status,
        first_kickoff_time: data.first_kickoff_time,
        last_kickoff_time: data.last_kickoff_time
      };
    } catch (error) {
      console.error('Error getting week status:', error);
      throw error;
    }
  }
  
  /**
   * Get the current active week (first week that is not completed)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<number>} Current week number
   */
  static async getCurrentWeek(seasonYear = 2025) {
    try {
      // Check weeks 1-18 to find the first non-completed week
      for (let week = 1; week <= 18; week++) {
        const weekStatus = await this.getWeekStatus(week, seasonYear);
        if (weekStatus.status !== 'completed') {
          return week;
        }
      }
      return 18; // Default to last week if all are completed
    } catch (error) {
      console.error('Error getting current week:', error);
      return 1; // Default fallback
    }
  }
  
  /**
   * Get status for all weeks in the season
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of week status objects
   */
  static async getAllWeeksStatus(seasonYear = 2025) {
    try {
      const weeks = [];
      for (let week = 1; week <= 18; week++) {
        const weekStatus = await this.getWeekStatus(week, seasonYear);
        weeks.push(weekStatus);
      }
      return weeks;
    } catch (error) {
      console.error('Error getting all weeks status:', error);
      throw error;
    }
  }
  
  /**
   * Get weeks that are ready to be closed (completed games + buffer time passed)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of weeks ready to close
   */
  static async getWeeksReadyToClose(seasonYear = 2025) {
    try {
      const allWeeks = await this.getAllWeeksStatus(seasonYear);
      return allWeeks.filter(week => week.status === 'closing');
    } catch (error) {
      console.error('Error getting weeks ready to close:', error);
      throw error;
    }
  }
  
  /**
   * Check if a week is live (has started but not completed)
   * @param {number} weekNumber - The week number
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<boolean>} Whether the week is live
   */
  static async isWeekLive(weekNumber, seasonYear = 2025) {
    try {
      const weekStatus = await this.getWeekStatus(weekNumber, seasonYear);
      return weekStatus.status === 'live';
    } catch (error) {
      console.error('Error checking if week is live:', error);
      return false;
    }
  }
  
  /**
   * Check if a week is completed
   * @param {number} weekNumber - The week number
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<boolean>} Whether the week is completed
   */
  static async isWeekCompleted(weekNumber, seasonYear = 2025) {
    try {
      const weekStatus = await this.getWeekStatus(weekNumber, seasonYear);
      return weekStatus.status === 'completed';
    } catch (error) {
      console.error('Error checking if week is completed:', error);
      return false;
    }
  }
}

module.exports = WeekStatus;