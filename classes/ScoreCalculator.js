const db = require('../config/database');
const HeadToHeadCalculator = require('./HeadToHeadCalculator');
const CascadingLineupProcessor = require('./CascadingLineupProcessor');
const StatsAggregator = require('./StatsAggregator');

/**
 * Main scoring calculator for fantasy football
 * Orchestrates all scoring calculations and matchup results
 */
class ScoreCalculator {
    constructor() {
        this.h2hCalculator = new HeadToHeadCalculator();
        this.cascadingProcessor = new CascadingLineupProcessor();
        this.statsAggregator = new StatsAggregator();
    }
    
    /**
     * Get all matchups for a week
     */
    async getWeeklyMatchups(week, gameType = 'primary', season = 2024) {
        // Get schedule for the week
        const sql = `
            SELECT 
                ws.*,
                ft1.team_id as team1_id, ft1.team_name as team1_name, 
                u1.username as team1_owner,
                ft2.team_id as team2_id, ft2.team_name as team2_name,
                u2.username as team2_owner
            FROM weekly_schedule ws
            JOIN schedule_assignments sa1 ON ws.team_1_position = sa1.schedule_position 
                AND sa1.season_year = ws.season_year
            JOIN fantasy_teams ft1 ON sa1.fantasy_team_id = ft1.team_id
            JOIN users u1 ON ft1.user_id = u1.user_id
            JOIN schedule_assignments sa2 ON ws.team_2_position = sa2.schedule_position 
                AND sa2.season_year = ws.season_year
            JOIN fantasy_teams ft2 ON sa2.fantasy_team_id = ft2.team_id
            JOIN users u2 ON ft2.user_id = u2.user_id
            WHERE ws.week_number = ? AND ws.game_type = ? AND ws.season_year = ?
            ORDER BY ws.schedule_id
        `;
        
        const matchups = await db.query(sql, [week, gameType, season]);
        
        if (!matchups || matchups.length === 0) {
            return [];
        }
        
        const results = [];
        for (const matchup of matchups) {
            // Calculate the matchup
            const matchupResult = await this.h2hCalculator.calculateMatchup(
                matchup.team1_id,
                matchup.team2_id,
                week,
                gameType,
                season
            );
            
            if (matchupResult) {
                // Add team info
                matchupResult.team1_name = matchup.team1_name;
                matchupResult.team1_owner = matchup.team1_owner;
                matchupResult.team2_name = matchup.team2_name;
                matchupResult.team2_owner = matchup.team2_owner;
                
                results.push(matchupResult);
            }
        }
        
        return results;
    }
    
    /**
     * Get detailed score breakdown for a single team
     */
    async getTeamScoreBreakdown(fantasyTeamId, week, gameType = 'primary', season = 2024) {
        // Get active lineup
        const activeLineup = await this.cascadingProcessor.getActiveLineup(fantasyTeamId, week, gameType, season);
        
        if (!activeLineup) {
            return null;
        }
        
        // Get cascading status
        const cascadingStatus = await this.cascadingProcessor.getCascadingStatus(fantasyTeamId, week, gameType, season);
        
        // Get aggregated stats
        const teamStats = await this.statsAggregator.aggregateTeamStats(activeLineup, week, season);
        
        // Get individual player stats
        const playerBreakdown = await this.getPlayerBreakdown(activeLineup, week, season);
        
        // Get team info
        const teamInfo = await this.getTeamInfo(fantasyTeamId);
        
        return {
            team_info: teamInfo,
            week,
            game_type: gameType,
            season,
            active_lineup: activeLineup,
            cascading_status: cascadingStatus,
            team_stats: teamStats,
            player_breakdown: playerBreakdown
        };
    }
    
    /**
     * Get detailed player-by-player breakdown
     */
    async getPlayerBreakdown(activeLineup, week, season) {
        const breakdown = {
            quarterbacks: [],
            running_backs: [],
            receivers: [],
            place_kickers: [],
            defense: []
        };
        
        // Process QBs
        for (const qb of activeLineup.quarterbacks) {
            if (qb.player_id) {
                const stats = await this.statsAggregator.getDetailedPlayerStats(qb.player_id, week, season);
                breakdown.quarterbacks.push({
                    player: qb,
                    stats
                });
            }
        }
        
        // Process RBs
        for (const rb of activeLineup.running_backs) {
            if (rb.player_id) {
                const stats = await this.statsAggregator.getDetailedPlayerStats(rb.player_id, week, season);
                breakdown.running_backs.push({
                    player: rb,
                    stats
                });
            }
        }
        
        // Process Receivers
        for (const rc of activeLineup.receivers) {
            if (rc.player_id) {
                const stats = await this.statsAggregator.getDetailedPlayerStats(rc.player_id, week, season);
                breakdown.receivers.push({
                    player: rc,
                    stats
                });
            }
        }
        
        // Process Kickers
        for (const k of activeLineup.place_kickers) {
            if (k.player_id) {
                const stats = await this.statsAggregator.getDetailedPlayerStats(k.player_id, week, season);
                breakdown.place_kickers.push({
                    player: k,
                    stats
                });
            }
        }
        
        // Process Defense
        for (const def of activeLineup.defense) {
            if (def.nfl_team_id) {
                const stats = await this.statsAggregator.getDefenseStats(def.nfl_team_id, week, season);
                breakdown.defense.push({
                    player: def,
                    stats
                });
            }
        }
        
        return breakdown;
    }
    
    /**
     * Get team information
     */
    async getTeamInfo(fantasyTeamId) {
        const sql = `
            SELECT 
                ft.team_id, ft.team_name,
                u.username, u.first_name, u.last_name
            FROM fantasy_teams ft
            JOIN users u ON ft.user_id = u.user_id
            WHERE ft.team_id = ?
        `;
        
        const result = await db.query(sql, [fantasyTeamId]);
        
        if (result && result.length > 0) {
            return result[0];
        }
        
        return null;
    }
    
    /**
     * Get standings for the season
     */
    async getSeasonStandings(season = 2024) {
        const teams = await this.getAllTeams();
        const standings = [];
        
        for (const team of teams) {
            const record = await this.getTeamRecord(team.team_id, season);
            standings.push({
                team_id: team.team_id,
                team_name: team.team_name,
                owner: team.username,
                wins: record.wins,
                losses: record.losses,
                ties: record.ties,
                points_for: record.points_for,
                points_against: record.points_against,
                win_percentage: record.win_percentage
            });
        }
        
        // Sort by win percentage, then by points for
        standings.sort((a, b) => {
            if (a.win_percentage === b.win_percentage) {
                return b.points_for - a.points_for;
            }
            return b.win_percentage - a.win_percentage;
        });
        
        return standings;
    }
    
    /**
     * Get team's win/loss record
     */
    async getTeamRecord(teamId, season) {
        const record = {
            wins: 0,
            losses: 0,
            ties: 0,
            points_for: 0,
            points_against: 0,
            win_percentage: 0
        };
        
        // Get all weeks that have been played
        const sql = `
            SELECT DISTINCT week_number 
            FROM lineup_submissions 
            WHERE season_year = ? 
            ORDER BY week_number
        `;
        
        const weeks = await db.query(sql, [season]);
        
        for (const weekRow of weeks) {
            const week = weekRow.week_number;
            
            // Get matchup for this team this week
            const matchup = await this.getTeamMatchup(teamId, week, 'primary', season);
            
            if (matchup) {
                const isTeam1 = (matchup.team1_id === teamId);
                
                if (isTeam1) {
                    record.points_for += matchup.team1_final_score;
                    record.points_against += matchup.team2_final_score;
                    
                    if (matchup.winner === 'team1') {
                        record.wins++;
                    } else if (matchup.winner === 'team2') {
                        record.losses++;
                    } else {
                        record.ties++;
                    }
                } else {
                    record.points_for += matchup.team2_final_score;
                    record.points_against += matchup.team1_final_score;
                    
                    if (matchup.winner === 'team2') {
                        record.wins++;
                    } else if (matchup.winner === 'team1') {
                        record.losses++;
                    } else {
                        record.ties++;
                    }
                }
            }
        }
        
        // Calculate win percentage
        const totalGames = record.wins + record.losses + record.ties;
        if (totalGames > 0) {
            record.win_percentage = (record.wins + (record.ties * 0.5)) / totalGames;
        }
        
        return record;
    }
    
    /**
     * Get a team's matchup for a specific week
     */
    async getTeamMatchup(teamId, week, gameType, season) {
        // Get the team's schedule position
        const sql = `
            SELECT schedule_position 
            FROM schedule_assignments 
            WHERE fantasy_team_id = ? AND season_year = ?
        `;
        
        const result = await db.query(sql, [teamId, season]);
        
        if (!result || result.length === 0) {
            return null;
        }
        
        const position = result[0].schedule_position;
        
        // Find the matchup where this team is involved
        const matchupSql = `
            SELECT 
                ws.*,
                sa1.fantasy_team_id as team1_id,
                sa2.fantasy_team_id as team2_id
            FROM weekly_schedule ws
            JOIN schedule_assignments sa1 ON ws.team_1_position = sa1.schedule_position 
                AND sa1.season_year = ws.season_year
            JOIN schedule_assignments sa2 ON ws.team_2_position = sa2.schedule_position 
                AND sa2.season_year = ws.season_year
            WHERE ws.week_number = ? AND ws.game_type = ? AND ws.season_year = ?
                AND (ws.team_1_position = ? OR ws.team_2_position = ?)
        `;
        
        const matchupData = await db.query(matchupSql, [week, gameType, season, position, position]);
        
        if (!matchupData || matchupData.length === 0) {
            return null;
        }
        
        // Calculate the matchup
        return await this.h2hCalculator.calculateMatchup(
            matchupData[0].team1_id,
            matchupData[0].team2_id,
            week,
            gameType,
            season
        );
    }
    
    /**
     * Get all teams
     */
    async getAllTeams() {
        const sql = `
            SELECT 
                ft.team_id, ft.team_name,
                u.username, u.first_name, u.last_name
            FROM fantasy_teams ft
            JOIN users u ON ft.user_id = u.user_id
            ORDER BY ft.team_name
        `;
        
        return await db.query(sql);
    }
    
    /**
     * Get available seasons
     */
    async getAvailableSeasons() {
        const sql = `
            SELECT DISTINCT season_year 
            FROM lineup_submissions 
            ORDER BY season_year DESC
        `;
        
        const result = await db.query(sql);
        
        return result.map(row => row.season_year);
    }
    
    /**
     * Get available weeks for a season
     */
    async getAvailableWeeks(season) {
        const sql = `
            SELECT DISTINCT week_number 
            FROM lineup_submissions 
            WHERE season_year = ?
            ORDER BY week_number
        `;
        
        const result = await db.query(sql, [season]);
        
        return result.map(row => row.week_number);
    }
}

module.exports = ScoreCalculator;