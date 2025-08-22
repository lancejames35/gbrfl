const db = require('../config/database');

/**
 * Aggregates statistics from player_stats and team_defense_stats tables
 */
class StatsAggregator {
    
    /**
     * Get player stats for a specific week
     */
    async getPlayerStats(playerId, week, season = 2024) {
        const sql = `
            SELECT 
                ps.*,
                np.display_name,
                np.position,
                nt.team_code
            FROM player_stats ps
            LEFT JOIN nfl_players np ON CAST(ps.player_id AS CHAR) = CAST(np.player_id AS CHAR)
            LEFT JOIN nfl_teams nt ON ps.team COLLATE utf8mb4_unicode_ci = nt.team_code COLLATE utf8mb4_unicode_ci
            WHERE ps.player_id = ? AND ps.week = ? AND ps.season = ?
        `;
        
        const result = await db.query(sql, [playerId, week, season]);
        
        if (!result || result.length === 0) {
            // Return zero stats if no data found
            return this.getEmptyPlayerStats();
        }
        
        return result[0];
    }
    
    /**
     * Get defense/team stats for a specific week
     */
    async getDefenseStats(nflTeamId, week, season = 2024) {
        const sql = `
            SELECT 
                tds.*,
                nt.team_name,
                nt.team_code
            FROM team_defense_stats tds
            JOIN nfl_teams nt ON tds.team COLLATE utf8mb4_unicode_ci = nt.team_code COLLATE utf8mb4_unicode_ci
            WHERE nt.nfl_team_id = ? AND tds.week = ? AND tds.season = ?
        `;
        
        const result = await db.query(sql, [nflTeamId, week, season]);
        
        if (!result || result.length === 0) {
            return this.getEmptyDefenseStats();
        }
        
        const stats = result[0];
        
        // Calculate total defensive points scored
        stats.total_points_scored = (stats.defensive_touchdowns * 6) + 
                                    (stats.special_teams_touchdowns * 6) + 
                                    (stats.safeties * 2) +
                                    (stats.special_teams_2pt_conversions * 2);
        
        return stats;
    }
    
    /**
     * Aggregate stats for an entire team's active lineup
     */
    async aggregateTeamStats(activeLineup, week, season = 2024) {
        const totals = {
            passing: {
                touchdowns: 0,
                yards: 0,
                completions: 0,
                attempts: 0,
                interceptions: 0
            },
            rushing: {
                touchdowns: 0,
                yards: 0,
                attempts: 0
            },
            receiving: {
                touchdowns: 0,
                yards: 0,
                receptions: 0
            },
            kicking: {
                fg_under_30: 0,
                fg_30_39: 0,
                fg_40_49: 0,
                fg_50_plus: 0,
                extra_points: 0,
                total_points: 0
            },
            defense: {
                points_allowed: 0,
                yards_allowed: 0,
                interceptions: 0,
                fumbles_recovered: 0,
                sacks: 0,
                points_scored: 0
            },
            cumulative: {
                fumbles_lost: 0,
                two_point_conversions: 0
            }
        };
        
        // Aggregate QB stats
        for (const qb of activeLineup.quarterbacks) {
            if (qb.player_id) {
                const stats = await this.getPlayerStats(qb.player_id, week, season);
                totals.passing.touchdowns += stats.pass_touchdowns || 0;
                totals.passing.yards += stats.pass_yards || 0;
                totals.passing.completions += stats.pass_completions || 0;
                totals.passing.attempts += stats.pass_attempts || 0;
                totals.passing.interceptions += stats.interceptions || 0;
                
                // QBs can also have rushing stats
                totals.rushing.touchdowns += stats.rush_touchdowns || 0;
                totals.rushing.yards += stats.rush_yards || 0;
                totals.rushing.attempts += stats.rush_attempts || 0;
                
                totals.cumulative.fumbles_lost += stats.fumbles_lost || 0;
                totals.cumulative.two_point_conversions += stats.two_point_conversions || 0;
            }
        }
        
        // Aggregate RB stats
        for (const rb of activeLineup.running_backs) {
            if (rb.player_id) {
                const stats = await this.getPlayerStats(rb.player_id, week, season);
                totals.rushing.touchdowns += stats.rush_touchdowns || 0;
                totals.rushing.yards += stats.rush_yards || 0;
                totals.rushing.attempts += stats.rush_attempts || 0;
                
                // RBs can also have receiving stats
                totals.receiving.touchdowns += stats.receiving_touchdowns || 0;
                totals.receiving.yards += stats.receiving_yards || 0;
                totals.receiving.receptions += stats.receptions || 0;
                
                totals.cumulative.fumbles_lost += stats.fumbles_lost || 0;
                totals.cumulative.two_point_conversions += stats.two_point_conversions || 0;
            }
        }
        
        // Aggregate Receiver stats (WR/TE)
        for (const rc of activeLineup.receivers) {
            if (rc.player_id) {
                const stats = await this.getPlayerStats(rc.player_id, week, season);
                totals.receiving.touchdowns += stats.receiving_touchdowns || 0;
                totals.receiving.yards += stats.receiving_yards || 0;
                totals.receiving.receptions += stats.receptions || 0;
                
                // Some receivers might have rushing stats
                totals.rushing.touchdowns += stats.rush_touchdowns || 0;
                totals.rushing.yards += stats.rush_yards || 0;
                totals.rushing.attempts += stats.rush_attempts || 0;
                
                totals.cumulative.fumbles_lost += stats.fumbles_lost || 0;
                totals.cumulative.two_point_conversions += stats.two_point_conversions || 0;
            }
        }
        
        // Aggregate Kicker stats
        for (const k of activeLineup.place_kickers) {
            if (k.player_id) {
                const stats = await this.getPlayerStats(k.player_id, week, season);
                totals.kicking.fg_under_30 += stats.fg_under_30 || 0;
                totals.kicking.fg_30_39 += stats.fg_30_39 || 0;
                totals.kicking.fg_40_49 += stats.fg_40_49 || 0;
                totals.kicking.fg_50_plus += stats.fg_50_plus || 0;
                totals.kicking.extra_points += stats.extra_points_made || 0;
                
                // Calculate total kicking points
                const kickingPoints = ((stats.fg_under_30 || 0) * 3) +
                                    ((stats.fg_30_39 || 0) * 3) +
                                    ((stats.fg_40_49 || 0) * 4) +
                                    ((stats.fg_50_plus || 0) * 5) +
                                    ((stats.extra_points_made || 0) * 1);
                totals.kicking.total_points += kickingPoints;
            }
        }
        
        // Aggregate Defense stats
        for (const def of activeLineup.defense) {
            if (def.nfl_team_id) {
                const stats = await this.getDefenseStats(def.nfl_team_id, week, season);
                totals.defense.points_allowed += stats.points_allowed || 0;
                totals.defense.yards_allowed += stats.total_yards_allowed || 0;
                totals.defense.interceptions += stats.interceptions || 0;
                totals.defense.fumbles_recovered += stats.fumbles_recovered || 0;
                totals.defense.sacks += stats.sacks || 0;
                totals.defense.points_scored += stats.total_points_scored || 0;
            }
        }
        
        // Calculate derived stats
        totals.passing.completion_pct = totals.passing.attempts > 0 
            ? (totals.passing.completions / totals.passing.attempts) * 100 
            : 0;
            
        totals.rushing.yards_per_attempt = totals.rushing.attempts > 0
            ? totals.rushing.yards / totals.rushing.attempts
            : 0;
            
        totals.receiving.yards_per_reception = totals.receiving.receptions > 0
            ? totals.receiving.yards / totals.receiving.receptions
            : 0;
        
        return totals;
    }
    
    /**
     * Get detailed player stats for display
     */
    async getDetailedPlayerStats(playerId, week, season = 2024) {
        const stats = await this.getPlayerStats(playerId, week, season);
        
        if (!stats) {
            return null;
        }
        
        // Add calculated fields
        stats.completion_pct = (stats.pass_attempts || 0) > 0 
            ? ((stats.pass_completions || 0) / stats.pass_attempts) * 100 
            : 0;
            
        stats.yards_per_rush = (stats.rush_attempts || 0) > 0
            ? (stats.rush_yards || 0) / stats.rush_attempts
            : 0;
            
        stats.yards_per_reception = (stats.receptions || 0) > 0
            ? (stats.receiving_yards || 0) / stats.receptions
            : 0;
            
        // Calculate kicking points
        if ((stats.fg_under_30 || 0) || (stats.fg_30_39 || 0) || (stats.fg_40_49 || 0) || (stats.fg_50_plus || 0)) {
            stats.kicking_points = ((stats.fg_under_30 || 0) * 3) +
                                   ((stats.fg_30_39 || 0) * 3) +
                                   ((stats.fg_40_49 || 0) * 4) +
                                   ((stats.fg_50_plus || 0) * 5) +
                                   ((stats.extra_points_made || 0) * 1);
        }
        
        return stats;
    }
    
    /**
     * Get coach performance for tiebreaker
     */
    async getCoachPerformance(coachName, week, season = 2024) {
        // Find the NFL team for this coach
        const sql = `
            SELECT nt.*, tds.*
            FROM nfl_teams nt
            JOIN team_defense_stats tds ON tds.team COLLATE utf8mb4_unicode_ci = nt.team_code COLLATE utf8mb4_unicode_ci
            WHERE nt.head_coach = ? AND tds.week = ? AND tds.season = ?
        `;
        
        const result = await db.query(sql, [coachName, week, season]);
        
        if (!result || result.length === 0) {
            return null;
        }
        
        const teamStats = result[0];
        
        // Determine if team won, lost, or tied
        // This would need actual game results - simplified for now
        const coachResult = {
            coach_name: coachName,
            team: teamStats.team_name,
            opponent: teamStats.opponent,
            points_scored: 0, // Would need actual offensive points
            points_allowed: teamStats.points_allowed,
            result: 'pending' // 'win', 'loss', 'tie'
        };
        
        return coachResult;
    }
    
    /**
     * Return empty player stats structure
     */
    getEmptyPlayerStats() {
        return {
            pass_completions: 0,
            pass_attempts: 0,
            pass_yards: 0,
            pass_touchdowns: 0,
            interceptions: 0,
            rush_attempts: 0,
            rush_yards: 0,
            rush_touchdowns: 0,
            receptions: 0,
            receiving_yards: 0,
            receiving_touchdowns: 0,
            fumbles_lost: 0,
            two_point_conversions: 0,
            fg_under_30: 0,
            fg_30_39: 0,
            fg_40_49: 0,
            fg_50_plus: 0,
            extra_points_made: 0
        };
    }
    
    /**
     * Return empty defense stats structure
     */
    getEmptyDefenseStats() {
        return {
            sacks: 0,
            fumbles_recovered: 0,
            interceptions: 0,
            total_yards_allowed: 0,
            points_allowed: 0,
            safeties: 0,
            defensive_touchdowns: 0,
            special_teams_touchdowns: 0,
            special_teams_2pt_conversions: 0,
            total_points_scored: 0
        };
    }
}

module.exports = StatsAggregator;