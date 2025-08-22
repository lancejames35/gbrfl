const CascadingLineupProcessor = require('./CascadingLineupProcessor');
const StatsAggregator = require('./StatsAggregator');

/**
 * Calculates head-to-head matchup results between two teams
 */
class HeadToHeadCalculator {
    constructor() {
        this.cascadingProcessor = new CascadingLineupProcessor();
        this.statsAggregator = new StatsAggregator();
        this.scoringRules = require('../config/scoring_rules');
    }
    
    /**
     * Calculate complete matchup between two teams
     */
    async calculateMatchup(team1Id, team2Id, week, gameType = 'primary', season = 2024) {
        // Get active lineups after cascading
        const team1Lineup = await this.cascadingProcessor.getActiveLineup(team1Id, week, gameType, season);
        const team2Lineup = await this.cascadingProcessor.getActiveLineup(team2Id, week, gameType, season);
        
        if (!team1Lineup || !team2Lineup) {
            return null;
        }
        
        // Aggregate stats for both teams
        const team1Stats = await this.statsAggregator.aggregateTeamStats(team1Lineup, week, season);
        const team2Stats = await this.statsAggregator.aggregateTeamStats(team2Lineup, week, season);
        
        // Compare teams and calculate scores
        let matchupResult = this.compareTeams(team1Stats, team2Stats);
        
        // Add team information
        matchupResult.team1_id = team1Id;
        matchupResult.team2_id = team2Id;
        matchupResult.week = week;
        matchupResult.game_type = gameType;
        matchupResult.season = season;
        
        // Add lineup information
        matchupResult.team1_lineup = team1Lineup;
        matchupResult.team2_lineup = team2Lineup;
        
        // Add aggregated stats
        matchupResult.team1_stats = team1Stats;
        matchupResult.team2_stats = team2Stats;
        
        // Calculate final scores
        matchupResult.team1_final_score = matchupResult.team1_score + matchupResult.team1_bonus;
        matchupResult.team2_final_score = matchupResult.team2_score + matchupResult.team2_bonus;
        
        // Determine winner
        if (matchupResult.team1_final_score > matchupResult.team2_final_score) {
            matchupResult.winner = 'team1';
        } else if (matchupResult.team2_final_score > matchupResult.team1_final_score) {
            matchupResult.winner = 'team2';
        } else {
            matchupResult.winner = 'tie';
            // Apply tiebreaker if needed
            matchupResult = await this.applyTiebreaker(matchupResult, team1Lineup, team2Lineup, week, season);
        }
        
        return matchupResult;
    }
    
    /**
     * Compare two teams' stats and award points
     */
    compareTeams(team1Stats, team2Stats) {
        const result = {
            team1_score: 0,
            team2_score: 0,
            team1_bonus: 0,
            team2_bonus: 0,
            category_results: {}
        };
        
        const categories = this.scoringRules.categories;
        
        for (const [categoryName, categoryStats] of Object.entries(categories)) {
            result.category_results[categoryName] = {};
            
            for (const [statName, config] of Object.entries(categoryStats)) {
                // Get the stat values for both teams
                const team1Value = this.getStatValue(team1Stats, categoryName, statName, config);
                const team2Value = this.getStatValue(team2Stats, categoryName, statName, config);
                
                // Determine winner
                let team1Wins = false;
                if (config.lower_wins) {
                    // Lower value wins (e.g., fewer interceptions)
                    if (team1Value < team2Value) {
                        team1Wins = true;
                    } else if (team1Value === team2Value) {
                        // Tie - no points awarded
                        team1Wins = null;
                    }
                } else {
                    // Higher value wins (most categories)
                    if (team1Value > team2Value) {
                        team1Wins = true;
                    } else if (team1Value === team2Value) {
                        // Tie - no points awarded
                        team1Wins = null;
                    }
                }
                
                // Award head-to-head points
                if (team1Wins === true) {
                    result.team1_score += config.h2h_points;
                } else if (team1Wins === false) {
                    result.team2_score += config.h2h_points;
                }
                // If tie (null), no points awarded
                
                // Check for bonus points (both teams can earn bonus)
                if (config.bonus_threshold !== undefined) {
                    if (config.lower_wins) {
                        // For "lower is better" stats, bonus if UNDER threshold
                        if (team1Value <= config.bonus_threshold) {
                            result.team1_bonus += config.bonus_points;
                        }
                        if (team2Value <= config.bonus_threshold) {
                            result.team2_bonus += config.bonus_points;
                        }
                    } else {
                        // For regular stats, bonus if OVER threshold
                        if (team1Value >= config.bonus_threshold) {
                            result.team1_bonus += config.bonus_points;
                        }
                        if (team2Value >= config.bonus_threshold) {
                            result.team2_bonus += config.bonus_points;
                        }
                    }
                }
                
                // Store category result details
                result.category_results[categoryName][statName] = {
                    team1_value: Math.round(team1Value * 100) / 100,
                    team2_value: Math.round(team2Value * 100) / 100,
                    team1_wins: team1Wins,
                    h2h_points: config.h2h_points,
                    team1_bonus: 0,
                    team2_bonus: 0
                };
                
                // Add bonus details if applicable
                if (config.bonus_threshold !== undefined) {
                    let bonusAwarded1 = false;
                    let bonusAwarded2 = false;
                    
                    if (config.lower_wins) {
                        bonusAwarded1 = team1Value <= config.bonus_threshold;
                        bonusAwarded2 = team2Value <= config.bonus_threshold;
                    } else {
                        bonusAwarded1 = team1Value >= config.bonus_threshold;
                        bonusAwarded2 = team2Value >= config.bonus_threshold;
                    }
                    
                    if (bonusAwarded1) {
                        result.category_results[categoryName][statName].team1_bonus = config.bonus_points;
                    }
                    if (bonusAwarded2) {
                        result.category_results[categoryName][statName].team2_bonus = config.bonus_points;
                    }
                    
                    result.category_results[categoryName][statName].bonus_threshold = config.bonus_threshold;
                }
            }
        }
        
        return result;
    }
    
    /**
     * Get the value for a specific stat
     */
    getStatValue(teamStats, categoryName, statName, config) {
        // Handle derived stats
        if (config.derived) {
            switch (config.calculation) {
                case 'completions_divided_by_attempts':
                    return teamStats.passing.completion_pct;
                    
                case 'yards_divided_by_attempts':
                    return teamStats.rushing.yards_per_attempt;
                    
                case 'yards_divided_by_receptions':
                    return teamStats.receiving.yards_per_reception;
                    
                case 'fg_points_plus_extra_points':
                    return teamStats.kicking.total_points;
                    
                case 'defensive_points':
                    return teamStats.defense.points_scored;
                    
                default:
                    return 0;
            }
        }
        
        // Map stat field to actual value
        if (config.stat_field) {
            const field = config.stat_field;
            
            // Navigate the nested array structure
            switch (categoryName) {
                case 'passing':
                    return teamStats.passing[field] || 0;
                case 'rushing':
                    return teamStats.rushing[field] || 0;
                case 'receiving':
                    return teamStats.receiving[field] || 0;
                case 'kicking':
                    return teamStats.kicking[field] || 0;
                case 'defense':
                    return teamStats.defense[field] || 0;
                case 'cumulative':
                    return teamStats.cumulative[field] || 0;
                default:
                    return 0;
            }
        }
        
        return 0;
    }
    
    /**
     * Apply tiebreaker using coach performance
     */
    async applyTiebreaker(matchupResult, team1Lineup, team2Lineup, week, season) {
        if (!this.scoringRules.tiebreaker_rules.use_coach_performance) {
            return matchupResult;
        }
        
        const team1Coach = team1Lineup.head_coach;
        const team2Coach = team2Lineup.head_coach;
        
        const team1CoachPerf = await this.statsAggregator.getCoachPerformance(team1Coach, week, season);
        const team2CoachPerf = await this.statsAggregator.getCoachPerformance(team2Coach, week, season);
        
        matchupResult.tiebreaker = {
            team1_coach: team1Coach,
            team2_coach: team2Coach,
            team1_coach_result: team1CoachPerf,
            team2_coach_result: team2CoachPerf
        };
        
        // Award tiebreaker points based on coach results
        let team1TiebreakerPoints = 0;
        let team2TiebreakerPoints = 0;
        
        if (team1CoachPerf && team1CoachPerf.result === 'win') {
            team1TiebreakerPoints = this.scoringRules.tiebreaker_rules.coach_win_points;
        } else if (team1CoachPerf && team1CoachPerf.result === 'tie') {
            team1TiebreakerPoints = this.scoringRules.tiebreaker_rules.coach_tie_points;
        }
        
        if (team2CoachPerf && team2CoachPerf.result === 'win') {
            team2TiebreakerPoints = this.scoringRules.tiebreaker_rules.coach_win_points;
        } else if (team2CoachPerf && team2CoachPerf.result === 'tie') {
            team2TiebreakerPoints = this.scoringRules.tiebreaker_rules.coach_tie_points;
        }
        
        matchupResult.tiebreaker.team1_points = team1TiebreakerPoints;
        matchupResult.tiebreaker.team2_points = team2TiebreakerPoints;
        
        // Update winner if tiebreaker resolves it
        if (team1TiebreakerPoints > team2TiebreakerPoints) {
            matchupResult.winner = 'team1';
            matchupResult.winner_method = 'tiebreaker';
        } else if (team2TiebreakerPoints > team1TiebreakerPoints) {
            matchupResult.winner = 'team2';
            matchupResult.winner_method = 'tiebreaker';
        } else {
            matchupResult.winner = 'tie';
            matchupResult.winner_method = 'unresolved';
        }
        
        return matchupResult;
    }
    
    /**
     * Get summary of category wins for display
     */
    getCategorySummary(matchupResult) {
        const summary = {
            team1_categories_won: 0,
            team2_categories_won: 0,
            ties: 0,
            categories: {}
        };
        
        for (const [categoryName, stats] of Object.entries(matchupResult.category_results)) {
            let categoryPoints1 = 0;
            let categoryPoints2 = 0;
            
            for (const [statName, result] of Object.entries(stats)) {
                if (result.team1_wins === true) {
                    categoryPoints1 += result.h2h_points;
                } else if (result.team1_wins === false) {
                    categoryPoints2 += result.h2h_points;
                }
            }
            
            let categoryWinner;
            if (categoryPoints1 > categoryPoints2) {
                categoryWinner = 'team1';
                summary.team1_categories_won++;
            } else if (categoryPoints2 > categoryPoints1) {
                categoryWinner = 'team2';
                summary.team2_categories_won++;
            } else {
                categoryWinner = 'tie';
                summary.ties++;
            }
            
            summary.categories[categoryName] = {
                winner: categoryWinner,
                team1_points: categoryPoints1,
                team2_points: categoryPoints2
            };
        }
        
        return summary;
    }
}

module.exports = HeadToHeadCalculator;