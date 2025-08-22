const db = require('../config/database');

/**
 * Processes fantasy lineups with cascading logic
 * If a player didn't play or has zero stats, cascade to next player in that position
 */
class CascadingLineupProcessor {
    constructor() {
        this.scoringRules = require('../config/scoring_rules');
    }
    
    /**
     * Get the active lineup after applying cascading rules
     */
    async getActiveLineup(fantasyTeamId, week, gameType = 'primary', season = 2024) {
        // Get the submitted lineup
        const lineup = await this.getSubmittedLineup(fantasyTeamId, week, gameType, season);
        
        if (!lineup) {
            return null;
        }
        
        // Process cascading for each position type
        const activeLineup = {
            lineup_id: lineup.lineup_id,
            fantasy_team_id: fantasyTeamId,
            week,
            game_type: gameType,
            head_coach: lineup.head_coach,
            quarterbacks: [],
            running_backs: [],
            receivers: [],
            place_kickers: [],
            defense: []
        };
        
        // Group players by position
        const positionGroups = this.groupPlayersByPosition(lineup.positions);
        
        // Process each position group with cascading
        for (const [positionType, players] of Object.entries(positionGroups)) {
            const required = this.getRequiredCount(positionType);
            const active = await this.cascadePlayers(players, week, season, required);
            
            switch(positionType) {
                case 'quarterback':
                    activeLineup.quarterbacks = active;
                    break;
                case 'running_back':
                    activeLineup.running_backs = active;
                    break;
                case 'receiver':
                    activeLineup.receivers = active;
                    break;
                case 'place_kicker':
                    activeLineup.place_kickers = active;
                    break;
                case 'defense':
                    activeLineup.defense = active;
                    break;
            }
        }
        
        return activeLineup;
    }
    
    /**
     * Get submitted lineup from database
     */
    async getSubmittedLineup(fantasyTeamId, week, gameType, season) {
        const sql = `
            SELECT 
                ls.lineup_id, ls.fantasy_team_id, ls.week_number, ls.game_type, ls.head_coach,
                lp.position_type, lp.player_id, lp.nfl_team_id, lp.sort_order,
                np.display_name, np.position as player_position,
                nt.team_code
            FROM lineup_submissions ls
            JOIN lineup_positions lp ON ls.lineup_id = lp.lineup_id
            LEFT JOIN nfl_players np ON lp.player_id = np.player_id
            LEFT JOIN nfl_teams nt ON lp.nfl_team_id = nt.nfl_team_id
            WHERE ls.fantasy_team_id = ? 
                AND ls.week_number = ? 
                AND ls.game_type = ?
                AND ls.season_year = ?
            ORDER BY lp.position_type, lp.sort_order
        `;
        
        const result = await db.query(sql, [fantasyTeamId, week, gameType, season]);
        
        if (!result || result.length === 0) {
            return null;
        }
        
        const lineup = {
            lineup_id: result[0].lineup_id,
            fantasy_team_id: result[0].fantasy_team_id,
            week_number: result[0].week_number,
            game_type: result[0].game_type,
            head_coach: result[0].head_coach,
            positions: []
        };
        
        for (const row of result) {
            lineup.positions.push({
                position_type: row.position_type,
                player_id: row.player_id,
                nfl_team_id: row.nfl_team_id,
                sort_order: row.sort_order,
                display_name: row.display_name,
                player_position: row.player_position,
                team_code: row.team_code
            });
        }
        
        return lineup;
    }
    
    /**
     * Group players by position type
     */
    groupPlayersByPosition(positions) {
        const groups = {};
        
        for (const position of positions) {
            const type = position.position_type;
            if (!groups[type]) {
                groups[type] = [];
            }
            groups[type].push(position);
        }
        
        return groups;
    }
    
    /**
     * Apply cascading logic to get active players
     */
    async cascadePlayers(players, week, season, requiredCount) {
        const activePlayers = [];
        
        for (const player of players) {
            // Skip if we have enough active players
            if (activePlayers.length >= requiredCount) {
                break;
            }
            
            // Check if this is a defense/team or individual player
            if (player.position_type === 'defense') {
                // For defense, check team stats
                if (await this.defenseHasStats(player.nfl_team_id, week, season)) {
                    activePlayers.push(player);
                }
            } else if (player.player_id) {
                // For individual players, check if they have stats
                if (await this.playerHasStats(player.player_id, week, season)) {
                    activePlayers.push(player);
                }
            }
        }
        
        // If we don't have enough active players, fill with remaining (even if no stats)
        // This handles bye weeks or injuries
        if (activePlayers.length < requiredCount) {
            for (const player of players) {
                if (!activePlayers.includes(player)) {
                    activePlayers.push(player);
                    if (activePlayers.length >= requiredCount) {
                        break;
                    }
                }
            }
        }
        
        return activePlayers;
    }
    
    /**
     * Check if a player has recorded stats for the week
     */
    async playerHasStats(playerId, week, season) {
        const sql = `
            SELECT 
                (pass_attempts + rush_attempts + receptions + 
                 fg_under_30 + fg_30_39 + fg_40_49 + fg_50_plus + 
                 extra_points_made + fumbles_lost + two_point_conversions) as total_activity
            FROM player_stats
            WHERE player_id = ? AND week = ? AND season = ?
        `;
        
        const result = await db.query(sql, [playerId, week, season]);
        
        if (!result || result.length === 0) {
            return false;
        }
        
        // If player has any recorded activity, they played
        return result[0].total_activity > 0;
    }
    
    /**
     * Check if a defense/team has recorded stats for the week
     */
    async defenseHasStats(nflTeamId, week, season) {
        const sql = `
            SELECT COUNT(*) as has_stats
            FROM team_defense_stats tds
            JOIN nfl_teams nt ON tds.team COLLATE utf8mb4_unicode_ci = nt.team_code COLLATE utf8mb4_unicode_ci
            WHERE nt.nfl_team_id = ? AND tds.week = ? AND tds.season = ?
        `;
        
        const result = await db.query(sql, [nflTeamId, week, season]);
        
        return result && result[0].has_stats > 0;
    }
    
    /**
     * Get required count for a position type
     */
    getRequiredCount(positionType) {
        const requirements = this.scoringRules.lineup_requirements;
        
        switch(positionType) {
            case 'quarterback':
                return requirements.quarterback;
            case 'running_back':
                return requirements.running_back;
            case 'receiver':
                return requirements.receiver;
            case 'place_kicker':
                return requirements.place_kicker;
            case 'defense':
                return requirements.defense;
            default:
                return 0;
        }
    }
    
    /**
     * Get cascading status for display purposes
     */
    async getCascadingStatus(fantasyTeamId, week, gameType = 'primary', season = 2024) {
        const lineup = await this.getSubmittedLineup(fantasyTeamId, week, gameType, season);
        if (!lineup) {
            return null;
        }
        
        const status = [];
        const positionGroups = this.groupPlayersByPosition(lineup.positions);
        
        for (const [positionType, players] of Object.entries(positionGroups)) {
            for (const player of players) {
                let hasStats = false;
                let isActive = false;
                
                if (player.position_type === 'defense') {
                    hasStats = await this.defenseHasStats(player.nfl_team_id, week, season);
                } else if (player.player_id) {
                    hasStats = await this.playerHasStats(player.player_id, week, season);
                }
                
                // Determine if player is active based on cascading
                const required = this.getRequiredCount(positionType);
                const activePlayers = await this.cascadePlayers(players, week, season, required);
                isActive = activePlayers.includes(player);
                
                status.push({
                    player_name: player.display_name || player.team_code || 'Unknown',
                    position: positionType,
                    sort_order: player.sort_order,
                    has_stats: hasStats,
                    is_active: isActive,
                    cascaded: !hasStats && isActive
                });
            }
        }
        
        return status;
    }
}

module.exports = CascadingLineupProcessor;