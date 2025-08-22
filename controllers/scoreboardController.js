const express = require('express');
const ScoreCalculator = require('../classes/ScoreCalculator');
const HeadToHeadCalculator = require('../classes/HeadToHeadCalculator');
const db = require('../config/database');

// Initialize calculators
const scoreCalculator = new ScoreCalculator();
const h2hCalculator = new HeadToHeadCalculator();

// Dummy data for scoreboard development (kept for fallback)
const dummyGameData = {
  gameId: 1,
  week: 6,
  gameType: 'primary',
  team1: {
    teamId: 1,
    name: 'LaPorta Potties',
    owner: 'Mike Johnson',
    totalScore: 87.2,
    status: 'losing',
    categories: {
      passing: { 
        points: 0,
        winner: false,
        stats: { yards: 450, tds: 3, completion: 65.2, ints: 2 }
      },
      rushing: { 
        points: 6,
        winner: true,
        stats: { yards: 287, tds: 4, ypc: 4.8 }
      },
      receiving: { 
        points: 6,
        winner: true,
        stats: { yards: 312, tds: 2, receptions: 18, ypr: 12.1 }
      },
      kicking: { 
        points: 0,
        winner: false,
        stats: { points: 12, fg_made: 2, fg_att: 3, long: 45 }
      },
      defense: { 
        points: 0,
        winner: false,
        stats: { points_allowed: 28, yards_allowed: 445, ints: 1, fumbles: 0, sacks: 3 }
      }
    },
    lineup: {
      qb1: { 
        name: 'Tom Brady', 
        team: 'TB',
        opponent: 'vs BUF',
        stats: { comp: 25, att: 35, yards: 287, tds: 2, ints: 1 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      qb2: { 
        name: 'Joe Burrow', 
        team: 'CIN',
        opponent: 'vs BAL',
        stats: { comp: 18, att: 28, yards: 163, tds: 1, ints: 1 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      rb1: { 
        name: 'Derrick Henry', 
        team: 'TEN',
        opponent: 'vs HOU',
        stats: { rush_att: 22, rush_yards: 156, rush_tds: 2, rec: 3, rec_yards: 24 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      rb2: { 
        name: 'Austin Ekeler', 
        team: 'LAC',
        opponent: 'vs DEN',
        stats: { rush_att: 15, rush_yards: 131, rush_tds: 2, rec: 6, rec_yards: 45 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      wr1: { 
        name: 'Cooper Kupp', 
        team: 'LAR',
        opponent: 'vs SF',
        stats: { rec: 8, rec_yards: 134, rec_tds: 1 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      wr2: { 
        name: 'Davante Adams', 
        team: 'LV',
        opponent: 'vs KC',
        stats: { rec: 6, rec_yards: 89, rec_tds: 0 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      wr3: { 
        name: 'Mike Evans', 
        team: 'TB',
        opponent: 'vs BUF',
        stats: { rec: 4, rec_yards: 89, rec_tds: 1 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      k1: { 
        name: 'Justin Tucker', 
        team: 'BAL',
        opponent: 'vs CIN',
        stats: { fg_made: 2, fg_att: 3, long: 45, xp_made: 0, xp_att: 0, points: 6 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      k2: { 
        name: 'Harrison Butker', 
        team: 'KC',
        opponent: 'vs LV',
        stats: { fg_made: 2, fg_att: 2, long: 38, xp_made: 2, xp_att: 2, points: 8 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      def1: { 
        name: 'Buffalo Bills', 
        team: 'BUF',
        opponent: 'vs TB',
        stats: { points_allowed: 28, yards_allowed: 445, ints: 1, fumbles: 0, sacks: 3, def_tds: 0 }, 
        status: 'final', 
        cascaded: false,
        active: true
      }
    }
  },
  team2: {
    teamId: 7,
    name: 'Captain Kirk',
    owner: 'Sarah Williams',
    totalScore: 92.5,
    status: 'winning',
    categories: {
      passing: { 
        points: 6,
        winner: true,
        stats: { yards: 523, tds: 4, completion: 72.1, ints: 1 }
      },
      rushing: { 
        points: 0,
        winner: false,
        stats: { yards: 203, tds: 2, ypc: 3.9 }
      },
      receiving: { 
        points: 0,
        winner: false,
        stats: { yards: 289, tds: 3, receptions: 22, ypr: 13.1 }
      },
      kicking: { 
        points: 6,
        winner: true,
        stats: { points: 18, fg_made: 4, fg_att: 4, long: 52 }
      },
      defense: { 
        points: 6,
        winner: true,
        stats: { points_allowed: 14, yards_allowed: 298, ints: 2, fumbles: 1, sacks: 5 }
      }
    },
    lineup: {
      qb1: { 
        name: 'Josh Allen', 
        team: 'BUF',
        opponent: 'vs TB',
        stats: { comp: 28, att: 40, yards: 342, tds: 3, ints: 0 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      qb2: { 
        name: 'Tua Tagovailoa', 
        team: 'MIA',
        opponent: 'vs NYJ',
        stats: { comp: 15, att: 22, yards: 181, tds: 1, ints: 1 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      rb1: { 
        name: 'Jonathan Taylor', 
        team: 'IND',
        opponent: 'vs JAX',
        stats: { rush_att: 18, rush_yards: 89, rush_tds: 1, rec: 2, rec_yards: 15 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      rb2: { 
        name: 'Alvin Kamara', 
        team: 'NO',
        opponent: 'vs ATL',
        stats: { rush_att: 16, rush_yards: 114, rush_tds: 1, rec: 4, rec_yards: 32 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      wr1: { 
        name: 'Stefon Diggs', 
        team: 'BUF',
        opponent: 'vs TB',
        stats: { rec: 9, rec_yards: 145, rec_tds: 2 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      wr2: { 
        name: 'A.J. Brown', 
        team: 'PHI',
        opponent: 'vs WAS',
        stats: { rec: 7, rec_yards: 89, rec_tds: 1 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      wr3: { 
        name: 'Tyreek Hill', 
        team: 'MIA',
        opponent: 'vs NYJ',
        stats: { rec: 6, rec_yards: 55, rec_tds: 0 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      k1: { 
        name: 'Daniel Carlson', 
        team: 'LV',
        opponent: 'vs KC',
        stats: { fg_made: 3, fg_att: 3, long: 52, xp_made: 3, xp_att: 3, points: 12 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      k2: { 
        name: 'Younghoe Koo', 
        team: 'ATL',
        opponent: 'vs NO',
        stats: { fg_made: 2, fg_att: 2, long: 41, xp_made: 0, xp_att: 0, points: 6 }, 
        status: 'final', 
        cascaded: false,
        active: true
      },
      def1: { 
        name: 'San Francisco 49ers', 
        team: 'SF',
        opponent: 'vs LAR',
        stats: { points_allowed: 14, yards_allowed: 298, ints: 2, fumbles: 1, sacks: 5, def_tds: 0 }, 
        status: 'final', 
        cascaded: false,
        active: true
      }
    }
  }
};

// Additional dummy games for navigation
const dummyGames = [
  dummyGameData,
  {
    gameId: 2,
    week: 6,
    gameType: 'primary',
    team1: { name: 'Touchdown Makers', totalScore: 78.3, status: 'losing' },
    team2: { name: 'End Zone Elites', totalScore: 85.7, status: 'winning' }
  },
  {
    gameId: 3,
    week: 6,
    gameType: 'bonus',
    team1: { name: 'Field Goal Kings', totalScore: 91.2, status: 'winning' },
    team2: { name: 'Sack Attack', totalScore: 88.9, status: 'losing' }
  }
];

// Controller methods
const scoreboardController = {
  // Main scoreboard view - current week, user's games
  getScoreboard: async (req, res) => {
    try {
      console.log('Loading scoreboard...');
      
      // Get parameters
      const season = req.query.season ? parseInt(req.query.season) : 2024;
      const gameType = req.query.game_type || 'primary';
      let currentWeek;
      try {
        currentWeek = req.query.week ? parseInt(req.query.week) : await getCurrentWeek(season);
      } catch (error) {
        console.log('Error getting current week, using fallback:', error.message);
        currentWeek = req.query.week ? parseInt(req.query.week) : 6; // Default to week 6 for testing
      }
      
      console.log(`Parameters: season=${season}, week=${currentWeek}, gameType=${gameType}`);
      
      // Get available data with fallbacks
      let seasons, weeks, teams;
      try {
        seasons = await scoreCalculator.getAvailableSeasons();
        weeks = await scoreCalculator.getAvailableWeeks(season);
        teams = await getAllTeams();
      } catch (error) {
        console.log('Database error, using fallback data:', error.message);
        seasons = [2024, 2023];
        weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        teams = [];
      }
      
      console.log(`Data counts: seasons=${seasons.length}, weeks=${weeks.length}, teams=${teams.length}`);
      
      // Get matchups for the week
      let matchups = [];
      try {
        matchups = await scoreCalculator.getWeeklyMatchups(currentWeek, gameType, season);
      } catch (error) {
        console.log('Error getting matchups, using dummy data:', error.message);
        matchups = [];
      }
      
      console.log(`Found ${matchups ? matchups.length : 0} matchups`);
      
      // Try to get real matchups, fall back to dummy data if needed
      let matchupsWithSummary = [];
      
      if (matchups && matchups.length > 0) {
        console.log('Using real matchup data');
        // Add category summaries to real data
        matchupsWithSummary = matchups.map(matchup => ({
          ...matchup,
          category_summary: h2hCalculator.getCategorySummary(matchup)
        }));
      } else {
        console.log('No real data found, creating sample matchup for testing');
        
        // Create a realistic sample matchup that shows the functionality
        try {
          const sampleTeam1Id = 1;
          const sampleTeam2Id = 2;
          
          // Try to calculate a real matchup if possible, otherwise use enhanced dummy
          const calculatedMatchup = await h2hCalculator.calculateMatchup(
            sampleTeam1Id, 
            sampleTeam2Id, 
            currentWeek, 
            gameType, 
            season
          ).catch(() => null);
          
          if (calculatedMatchup) {
            matchupsWithSummary = [calculatedMatchup];
          } else {
            // Enhanced dummy with proper structure for display
            matchupsWithSummary = [{
              team1_id: 1,
              team2_id: 2,
              team1_name: "LaPorta Potties",
              team2_name: "Captain Kirk", 
              team1_owner: "Mike Johnson",
              team2_owner: "Sarah Williams",
              team1_final_score: 87.2,
              team2_final_score: 92.5,
              team1_score: 15,
              team2_score: 18,
              team1_bonus: 7,
              team2_bonus: 12,
              winner: 'team2',
              week: currentWeek,
              season,
              game_type: gameType,
              category_results: {
                passing: {
                  touchdowns: { team1_value: 3, team2_value: 4, team1_wins: false, h2h_points: 6, team1_bonus: 0, team2_bonus: 0 },
                  yards: { team1_value: 450, team2_value: 523, team1_wins: false, h2h_points: 6, team1_bonus: 0, team2_bonus: 0 },
                  completion_pct: { team1_value: 65.2, team2_value: 72.1, team1_wins: false, h2h_points: 2, team1_bonus: 0, team2_bonus: 2, bonus_threshold: 69.0 },
                  fewer_interceptions: { team1_value: 2, team2_value: 1, team1_wins: false, h2h_points: 2, team1_bonus: 0, team2_bonus: 0 }
                },
                rushing: {
                  touchdowns: { team1_value: 4, team2_value: 2, team1_wins: true, h2h_points: 6, team1_bonus: 2, team2_bonus: 0, bonus_threshold: 4 },
                  yards: { team1_value: 287, team2_value: 203, team1_wins: true, h2h_points: 6, team1_bonus: 3, team2_bonus: 0, bonus_threshold: 250 },
                  yards_per_attempt: { team1_value: 4.8, team2_value: 3.9, team1_wins: true, h2h_points: 3, team1_bonus: 2, team2_bonus: 0, bonus_threshold: 4.20 }
                },
                receiving: {
                  touchdowns: { team1_value: 2, team2_value: 3, team1_wins: false, h2h_points: 6, team1_bonus: 0, team2_bonus: 0 },
                  yards: { team1_value: 312, team2_value: 289, team1_wins: true, h2h_points: 6, team1_bonus: 0, team2_bonus: 0 },
                  receptions: { team1_value: 18, team2_value: 22, team1_wins: false, h2h_points: 2, team1_bonus: 0, team2_bonus: 0 },
                  yards_per_reception: { team1_value: 12.1, team2_value: 13.1, team1_wins: false, h2h_points: 2, team1_bonus: 2, team2_bonus: 2, bonus_threshold: 12.0 }
                },
                kicking: {
                  total_points: { team1_value: 12, team2_value: 18, team1_wins: false, h2h_points: 3, team1_bonus: 2, team2_bonus: 2, bonus_threshold: 12 }
                },
                defense: {
                  points_allowed: { team1_value: 28, team2_value: 14, team1_wins: false, h2h_points: 6, team1_bonus: 0, team2_bonus: 2, bonus_threshold: 14 },
                  yards_allowed: { team1_value: 445, team2_value: 298, team1_wins: false, h2h_points: 3, team1_bonus: 0, team2_bonus: 0 }
                }
              }
            }];
          }
        } catch (error) {
          console.error('Error creating sample matchup:', error);
          matchupsWithSummary = [];
        }
      }
      
      // Try to find the user's matchup first
      let userMatchup = null;
      if (req.session.user && req.session.user.team_id) {
        userMatchup = matchupsWithSummary.find(matchup => 
          matchup.team1_id === req.session.user.team_id || 
          matchup.team2_id === req.session.user.team_id
        );
      }
      
      // If user has a matchup, put it first in the array
      if (userMatchup) {
        const otherMatchups = matchupsWithSummary.filter(m => m !== userMatchup);
        matchupsWithSummary.splice(0, matchupsWithSummary.length, userMatchup, ...otherMatchups);
      }
      
      // Get standings
      const standings = await scoreCalculator.getSeasonStandings(season);
      
      // Always use the enhanced layout
      const templatePath = 'scoreboard/index';
      
      res.render(templatePath, {
        title: `Scoreboard - Week ${currentWeek}`,
        activePage: 'scoreboard',
        season,
        week: currentWeek,
        gameType,
        seasons,
        weeks,
        teams,
        matchups: matchupsWithSummary,
        standings,
        gameTypes: ['primary', 'bonus']
      });
    } catch (error) {
      console.error('Error loading scoreboard:', error);
      res.status(500).render('error', { 
        title: 'Scoreboard Error',
        message: 'Failed to load scoreboard', 
        error: error.message 
      });
    }
  },

  // Specific week scoreboard
  getWeeklyScoreboard: async (req, res) => {
    try {
      const week = parseInt(req.params.week);
      const gameType = req.params.type || 'primary';
      
      // Filter games by week and type
      const weekGames = dummyGames.filter(game => 
        game.week === week && game.gameType === gameType
      );
      
      res.render('scoreboard/index', {
        title: `Week ${week} Scoreboard`,
        activePage: 'scoreboard',
        currentWeek: week,
        games: weekGames,
        selectedGame: weekGames[0],
        gameType,
        gameTypes: ['primary', 'bonus'],
        weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
      });
    } catch (error) {
      console.error('Error loading weekly scoreboard:', error);
      res.status(500).render('error', { message: 'Failed to load weekly scoreboard' });
    }
  },

  // Individual game detail
  getGameDetail: async (req, res) => {
    try {
      const gameId = parseInt(req.params.gameId);
      const game = dummyGames.find(g => g.gameId === gameId);
      
      if (!game) {
        return res.status(404).render('error', { message: 'Game not found' });
      }
      
      res.render('scoreboard/game-detail', {
        title: `${game.team1.name} vs ${game.team2.name}`,
        activePage: 'scoreboard',
        game,
        weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
      });
    } catch (error) {
      console.error('Error loading game detail:', error);
      res.status(500).render('error', { message: 'Failed to load game detail' });
    }
  },

  // AJAX endpoint for live updates (placeholder)
  getLiveUpdates: async (req, res) => {
    try {
      const gameId = parseInt(req.params.gameId);
      const game = dummyGames.find(g => g.gameId === gameId);
      
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      
      // Return updated game data (for now, just return static data)
      res.json({
        success: true,
        game,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting live updates:', error);
      res.status(500).json({ error: 'Failed to get live updates' });
    }
  },

  // Helper method to calculate category winners (placeholder)
  calculateCategoryWins: (team1, team2) => {
    const categories = ['passing', 'rushing', 'receiving', 'kicking', 'defense'];
    const results = {};
    
    categories.forEach(category => {
      // Simplified winner calculation for demo
      results[category] = {
        winner: Math.random() > 0.5 ? 'team1' : 'team2',
        points: 6
      };
    });
    
    return results;
  },

  // Helper method for cascading logic (placeholder)
  applyCascadingLogic: (lineup) => {
    // This will contain the complex substitution logic
    // For now, just return the lineup as-is
    return lineup;
  }
};

// Helper functions
async function getCurrentWeek(season) {
  try {
    const sql = 'SELECT MAX(week_number) as current_week FROM lineup_submissions WHERE season_year = ?';
    const result = await db.query(sql, [season]);
    return result && result.length > 0 ? result[0].current_week || 1 : 1;
  } catch (error) {
    console.error('Error getting current week:', error);
    return 1;
  }
}

async function getAllTeams() {
  try {
    const sql = `
      SELECT 
        ft.team_id, ft.team_name,
        u.username, u.first_name, u.last_name
      FROM fantasy_teams ft
      JOIN users u ON ft.user_id = u.user_id
      ORDER BY ft.team_name
    `;
    return await db.query(sql);
  } catch (error) {
    console.error('Error getting teams:', error);
    return [];
  }
}

module.exports = scoreboardController;