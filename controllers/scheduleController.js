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
const WeekStatus = require('../models/WeekStatus');
const MatchupScore = require('../models/MatchupScore');
const db = require('../config/database');

/**
 * Get current week based on NFL game completion status
 * @returns {number} Current week number
 */
async function getCurrentWeek() {
  try {
    return await WeekStatus.getCurrentWeek();
  } catch (error) {
    console.error('Error getting current week:', error);
    return 1; // Default fallback
  }
}

/**
 * Show the main schedule page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getSchedulePage = async (req, res) => {
  try {
    const currentWeek = await getCurrentWeek();
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
    const currentWeek = await getCurrentWeek();
    const { 
      view = 'league', 
      week = currentWeek, 
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

      // Get week status once for all games in this week
      const weekStatus = await WeekStatus.getWeekStatus(parseInt(week), parseInt(seasonYear));
      const isCompletedWeek = weekStatus.status === 'completed';

      // Show lineups for completed weeks OR locked weeks
      const shouldShowLineups = isCompletedWeek || isLocked;

      // Get manual scores for this week
      const manualScores = await MatchupScore.getScoresByWeek(parseInt(week), parseInt(seasonYear));
      const scoresMap = {};
      manualScores.forEach(score => {
        scoresMap[score.schedule_id] = score;
      });

      for (let game of scheduleData) {
        if (game.team_1 && game.team_2) {
          // Check if lineups were submitted for this week
          const team1Lineup = await LineupSubmission.getByTeamAndWeek(game.team_1.team_id, parseInt(week), game.game_type, parseInt(seasonYear));
          const team2Lineup = await LineupSubmission.getByTeamAndWeek(game.team_2.team_id, parseInt(week), game.game_type, parseInt(seasonYear));

          // Apply week status to this game
          game.is_completed = weekStatus.status === 'completed';
          game.is_live = weekStatus.status === 'live';

          // Add manual scores if they exist
          const manualScore = scoresMap[game.schedule_id];
          if (manualScore) {
            game.team_1_score = manualScore.team_1_score;
            game.team_2_score = manualScore.team_2_score;
            game.has_manual_score = true;

            // Determine winner
            if (manualScore.team_1_score > manualScore.team_2_score) {
              game.winner = 'team1';
            } else if (manualScore.team_2_score > manualScore.team_1_score) {
              game.winner = 'team2';
            } else {
              game.winner = 'tie';
            }
          } else {
            game.team_1_score = null;
            game.team_2_score = null;
            game.has_manual_score = false;
            game.winner = null;
          }
          
          // Add lineup data if lineups should be shown (completed or locked weeks)
          if (shouldShowLineups) {
            // Get lineup data for both teams
            if (team1Lineup) {
              // Always use LineupPosition data - it has the correct starter/backup positions
              const team1LineupPositions = await LineupPosition.getTeamRosterByPosition(game.team_1.team_id, team1Lineup.lineup_id);

              // Get head coach's NFL team
              let headCoachTeam = null;
              if (team1Lineup.head_coach) {
                const coachTeamRows = await db.query(
                  'SELECT team_name FROM nfl_teams WHERE head_coach = ?',
                  [team1Lineup.head_coach]
                );
                if (coachTeamRows.length > 0) {
                  headCoachTeam = coachTeamRows[0].team_name;
                }
              }

              game.team_1_lineup = {
                head_coach: team1Lineup.head_coach,
                head_coach_team: headCoachTeam,
                positions: team1LineupPositions
              };
            }

            if (team2Lineup) {
              // Always use LineupPosition data - it has the correct starter/backup positions
              const team2LineupPositions = await LineupPosition.getTeamRosterByPosition(game.team_2.team_id, team2Lineup.lineup_id);

              // Get head coach's NFL team
              let headCoachTeam = null;
              if (team2Lineup.head_coach) {
                const coachTeamRows = await db.query(
                  'SELECT team_name FROM nfl_teams WHERE head_coach = ?',
                  [team2Lineup.head_coach]
                );
                if (coachTeamRows.length > 0) {
                  headCoachTeam = coachTeamRows[0].team_name;
                }
              }

              game.team_2_lineup = {
                head_coach: team2Lineup.head_coach,
                head_coach_team: headCoachTeam,
                positions: team2LineupPositions
              };
            }
          }

          // Add lock status to game data - show as locked for both completed and locked weeks
          game.lineups_locked = shouldShowLineups;
        }
      }
    }
    
    res.json({
      success: true,
      data: scheduleData,
      currentWeek: currentWeek,
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

/**
 * Get historical lineup data organized by position for schedule display
 * @param {number} lineupId - The lineup ID (we'll look it up to get week/team info)
 * @param {number} seasonYear - The season year
 * @returns {Promise<Object|null>} Lineup data organized by position, or null if not found
 */
async function getHistoricalLineupPositions(lineupId, seasonYear) {
  try {
    // First, get the week and team info from the lineup_id
    const lineupInfo = await db.query(`
      SELECT week_number, game_type, fantasy_team_id
      FROM lineup_submissions
      WHERE lineup_id = ?
    `, [lineupId]);

    if (!lineupInfo || lineupInfo.length === 0) {
      return null;
    }

    const { week_number, game_type, fantasy_team_id } = lineupInfo[0];

    // Now fetch historical lineup data using week, game_type, and team_id
    const historicalData = await db.query(`
      SELECT
        player_id,
        player_name_at_time as display_name,
        position,
        lineup_position,
        espn_id
      FROM historical_lineups
      WHERE season_year = ? AND week_number = ? AND game_type = ? AND fantasy_team_id = ?
      ORDER BY lineup_position
    `, [seasonYear, week_number, game_type, fantasy_team_id]);

    if (!historicalData || historicalData.length === 0) {
      return null;
    }

    // Organize by position (matching format expected by schedule view)
    const organized = {
      quarterback: [],
      running_back: [],
      receiver: [],
      place_kicker: [],
      defense: []
    };

    // Position mapping
    const positionMap = {
      'QB': 'quarterback',
      'RB': 'running_back',
      'RC': 'receiver',
      'PK': 'place_kicker',
      'DU': 'defense'
    };

    historicalData.forEach(player => {
      const positionKey = positionMap[player.position];
      if (positionKey && organized[positionKey]) {
        organized[positionKey].push(player);
      }
    });

    return organized;
  } catch (error) {
    console.error('Error fetching historical lineup positions:', error);
    return null;
  }
}