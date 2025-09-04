/**
 * Schedule Controller
 * Handles all schedule-related functionality
 */

const WeeklySchedule = require('../models/WeeklySchedule');
const ScheduleAssignment = require('../models/ScheduleAssignment');
const FantasyTeam = require('../models/FantasyTeam');
const LineupSubmission = require('../models/LineupSubmission');
const LineupPosition = require('../models/LineupPosition');
const LineupLock = require('../models/LineupLock');

/**
 * Get current week based on current date and season settings
 * For now, we'll use a simple calculation - this can be enhanced later
 * @returns {number} Current week number
 */
function getCurrentWeek() {
  // For now, return week 1 as default
  // TODO: Implement proper current week logic based on league_settings and current date
  return 1;
}

/**
 * Show the main schedule page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getSchedulePage = async (req, res) => {
  try {
    const currentWeek = getCurrentWeek();
    const seasonYear = 2025; // TODO: Get from league settings
    
    // Get all teams for dropdown
    const teams = await FantasyTeam.getAll();
    
    // Get user's team if they have one
    let userTeam = null;
    if (req.session.user) {
      const userTeams = await FantasyTeam.findByUserId(req.session.user.id);
      userTeam = userTeams.length > 0 ? userTeams[0] : null;
    }
    
    res.render('schedule/index', {
      title: 'League Schedule',
      activePage: 'schedule',
      currentWeek,
      teams,
      userTeam,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading schedule page:', error);
    req.flash('error_msg', 'Error loading schedule');
    res.redirect('/dashboard');
  }
};

/**
 * Get schedule data for AJAX requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScheduleData = async (req, res) => {
  try {
    const { 
      view = 'league', 
      week = getCurrentWeek(), 
      team = null,
      seasonYear = 2025 
    } = req.query;
    
    let scheduleData = {};
    
    if (view === 'league') {
      // Get schedule for specific week
      scheduleData = await WeeklySchedule.getWeekScheduleWithTeams(parseInt(week), parseInt(seasonYear));
    } else if (view === 'team' && team) {
      // Get all games for specific team
      scheduleData = await WeeklySchedule.getUpcomingGamesForTeam(parseInt(team), parseInt(seasonYear));
      
      // Add team names to the opponent data
      const assignments = await ScheduleAssignment.getAllAssignments(parseInt(seasonYear));
      const positionToTeam = {};
      assignments.forEach(assignment => {
        positionToTeam[assignment.schedule_position] = {
          team_id: assignment.fantasy_team_id,
          team_name: assignment.team_name,
          username: assignment.username
        };
      });
      
      scheduleData = scheduleData.map(game => ({
        ...game,
        opponent: positionToTeam[game.opponent_position] || { team_name: `Position ${game.opponent_position}` }
      }))
      // Sort by week, then primary games first, then by schedule_id
      .sort((a, b) => {
        if (a.week_number !== b.week_number) return a.week_number - b.week_number;
        if (a.game_type !== b.game_type) {
          if (a.game_type === 'primary') return -1;
          if (b.game_type === 'primary') return 1;
        }
        return a.schedule_id - b.schedule_id;
      });
    }
    
    // Add lineup data for locked weeks and check completion status
    if (view === 'league') {
      // Check if lineups are locked for this week
      const lockStatus = await LineupLock.getLockStatus(parseInt(week), 'primary', parseInt(seasonYear));
      const isLocked = lockStatus.current_status === 'locked' || lockStatus.current_status === 'auto_locked';
      
      for (let game of scheduleData) {
        if (game.team_1 && game.team_2) {
          // Check if lineups were submitted for this week
          const team1Lineup = await LineupSubmission.getByTeamAndWeek(game.team_1.team_id, parseInt(week), 'primary', parseInt(seasonYear));
          const team2Lineup = await LineupSubmission.getByTeamAndWeek(game.team_2.team_id, parseInt(week), 'primary', parseInt(seasonYear));
          
          game.is_completed = !!(team1Lineup && team2Lineup);
          // Scores will be added when scoring system is implemented
          game.team_1_score = null;
          game.team_2_score = null;
          
          // Add lineup data if lineups are locked
          if (isLocked) {
            // Get lineup data for both teams
            if (team1Lineup) {
              const team1LineupPositions = await LineupPosition.getTeamRosterByPosition(game.team_1.team_id, team1Lineup.lineup_id);
              game.team_1_lineup = {
                head_coach: team1Lineup.head_coach,
                positions: team1LineupPositions
              };
            }
            
            if (team2Lineup) {
              const team2LineupPositions = await LineupPosition.getTeamRosterByPosition(game.team_2.team_id, team2Lineup.lineup_id);
              game.team_2_lineup = {
                head_coach: team2Lineup.head_coach,
                positions: team2LineupPositions
              };
            }
          }
          
          // Add lock status to game data
          game.lineups_locked = isLocked;
        }
      }
    }
    
    res.json({
      success: true,
      data: scheduleData,
      currentWeek: getCurrentWeek(),
      view,
      week: parseInt(week),
      team: team ? parseInt(team) : null
    });
  } catch (error) {
    console.error('Error fetching schedule data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching schedule data'
    });
  }
};

/**
 * Get schedule statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getScheduleStats = async (req, res) => {
  try {
    const { seasonYear = 2025 } = req.query;
    const stats = await WeeklySchedule.getScheduleStats(parseInt(seasonYear));
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching schedule stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching schedule statistics'
    });
  }
};