const db = require('../config/database');
const ScheduleAssignment = require('./ScheduleAssignment');

class WeeklySchedule {
  /**
   * Get schedule for a specific week
   * @param {number} weekNumber - The week number (1-17)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of games for the week
   */
  static async getScheduleByWeek(weekNumber, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          ws.schedule_id,
          ws.week_number,
          ws.team_1_position,
          ws.team_2_position,
          ws.game_type,
          ws.season_year,
          ws.created_at
        FROM weekly_schedule ws
        WHERE ws.week_number = ? AND ws.season_year = ?
        ORDER BY ws.game_type DESC, ws.schedule_id
      `;
      
      const schedule = await db.query(query, [weekNumber, seasonYear]);
      return schedule;
    } catch (error) {
      console.error('Error fetching schedule by week:', error);
      throw error;
    }
  }

  /**
   * Get the complete schedule for all weeks
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of all games grouped by week
   */
  static async getFullSchedule(seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          ws.schedule_id,
          ws.week_number,
          ws.team_1_position,
          ws.team_2_position,
          ws.game_type,
          ws.season_year,
          ws.created_at
        FROM weekly_schedule ws
        WHERE ws.season_year = ?
        ORDER BY ws.week_number, ws.game_type DESC, ws.schedule_id
      `;
      
      const schedule = await db.query(query, [seasonYear]);
      
      // Group by week
      const scheduleByWeek = {};
      schedule.forEach(game => {
        if (!scheduleByWeek[game.week_number]) {
          scheduleByWeek[game.week_number] = [];
        }
        scheduleByWeek[game.week_number].push(game);
      });
      
      return scheduleByWeek;
    } catch (error) {
      console.error('Error fetching full schedule:', error);
      throw error;
    }
  }

  /**
   * Get schedule with actual team names instead of position numbers
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object>} Schedule with team names grouped by week
   */
  static async getScheduleWithTeams(seasonYear = 2025) {
    try {
      // Get the full schedule
      const fullSchedule = await this.getFullSchedule(seasonYear);
      
      // Get all schedule assignments
      const assignments = await ScheduleAssignment.getAllAssignments(seasonYear);
      
      // Create a position-to-team mapping
      const positionToTeam = {};
      assignments.forEach(assignment => {
        positionToTeam[assignment.schedule_position] = {
          team_id: assignment.fantasy_team_id,
          team_name: assignment.team_name || `Position ${assignment.schedule_position}`,
          username: assignment.username,
          first_name: assignment.first_name,
          last_name: assignment.last_name
        };
      });
      
      // Transform schedule to include team names
      const scheduleWithTeams = {};
      
      Object.keys(fullSchedule).forEach(weekNumber => {
        scheduleWithTeams[weekNumber] = fullSchedule[weekNumber].map(game => {
          const team1 = positionToTeam[game.team_1_position] || {
            team_name: `Position ${game.team_1_position}`,
            team_id: null
          };
          const team2 = positionToTeam[game.team_2_position] || {
            team_name: `Position ${game.team_2_position}`,
            team_id: null
          };
          
          return {
            ...game,
            team_1: team1,
            team_2: team2,
            game_display: `${team1.team_name} vs ${team2.team_name}`
          };
        });
      });
      
      return scheduleWithTeams;
    } catch (error) {
      console.error('Error fetching schedule with teams:', error);
      throw error;
    }
  }

  /**
   * Get schedule for a specific week with team names
   * @param {number} weekNumber - The week number (1-17)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of games with team information
   */
  static async getWeekScheduleWithTeams(weekNumber, seasonYear = 2025) {
    try {
      const fullScheduleWithTeams = await this.getScheduleWithTeams(seasonYear);
      return fullScheduleWithTeams[weekNumber] || [];
    } catch (error) {
      console.error('Error fetching week schedule with teams:', error);
      throw error;
    }
  }

  /**
   * Get games by game type across all weeks
   * @param {string} gameType - The game type ('primary' or 'bonus')
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of games of the specified type
   */
  static async getGamesByType(gameType, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          ws.*
        FROM weekly_schedule ws
        WHERE ws.game_type = ? AND ws.season_year = ?
        ORDER BY ws.week_number, ws.schedule_id
      `;
      
      const games = await db.query(query, [gameType, seasonYear]);
      return games;
    } catch (error) {
      console.error('Error fetching games by type:', error);
      throw error;
    }
  }

  /**
   * Get upcoming games for a specific team
   * @param {number} teamId - The team ID
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of upcoming games for the team
   */
  static async getUpcomingGamesForTeam(teamId, seasonYear = 2025) {
    try {
      // First get the team's position
      const assignment = await ScheduleAssignment.getByTeamId(teamId, seasonYear);
      if (!assignment) {
        return [];
      }
      
      const position = assignment.schedule_position;
      
      const query = `
        SELECT 
          ws.*
        FROM weekly_schedule ws
        WHERE (ws.team_1_position = ? OR ws.team_2_position = ?) 
        AND ws.season_year = ?
        ORDER BY ws.week_number, ws.game_type DESC
      `;
      
      const games = await db.query(query, [position, position, seasonYear]);
      
      // Add opponent information
      const gamesWithOpponents = games.map(game => {
        const opponentPosition = game.team_1_position === position ? game.team_2_position : game.team_1_position;
        return {
          ...game,
          opponent_position: opponentPosition,
          is_home: game.team_1_position === position
        };
      });
      
      return gamesWithOpponents;
    } catch (error) {
      console.error('Error fetching upcoming games for team:', error);
      throw error;
    }
  }

  /**
   * Get statistics about the schedule
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Object>} Schedule statistics
   */
  static async getScheduleStats(seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_games,
          COUNT(CASE WHEN game_type = 'primary' THEN 1 END) as primary_games,
          COUNT(CASE WHEN game_type = 'bonus' THEN 1 END) as bonus_games,
          COUNT(DISTINCT week_number) as total_weeks
        FROM weekly_schedule
        WHERE season_year = ?
      `;
      
      const results = await db.query(query, [seasonYear]);
      return results[0] || {
        total_games: 0,
        primary_games: 0,
        bonus_games: 0,
        total_weeks: 0
      };
    } catch (error) {
      console.error('Error fetching schedule stats:', error);
      throw error;
    }
  }
}

module.exports = WeeklySchedule;