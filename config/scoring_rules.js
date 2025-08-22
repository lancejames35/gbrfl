/**
 * Fantasy Football Scoring Rules Configuration
 * George Blanda Rotisserie Football League
 */

module.exports = {
    categories: {
        passing: {
            touchdowns: {
                h2h_points: 6,
                bonus_threshold: 6,
                bonus_points: 2,
                stat_field: 'pass_touchdowns'
            },
            yards: {
                h2h_points: 6,
                bonus_threshold: 600,
                bonus_points: 2,
                stat_field: 'pass_yards'
            },
            completion_pct: {
                h2h_points: 2,
                bonus_threshold: 69.0,
                bonus_points: 2,
                derived: true,
                calculation: 'completions_divided_by_attempts'
            },
            fewer_interceptions: {
                h2h_points: 2,
                lower_wins: true,
                stat_field: 'interceptions'
            }
        },
        rushing: {
            touchdowns: {
                h2h_points: 6,
                bonus_threshold: 4,
                bonus_points: 2,
                stat_field: 'rush_touchdowns'
            },
            yards: {
                h2h_points: 6,
                bonus_threshold: 250,
                bonus_points: 3,
                stat_field: 'rush_yards'
            },
            yards_per_attempt: {
                h2h_points: 3,
                bonus_threshold: 4.20,
                bonus_points: 2,
                derived: true,
                calculation: 'yards_divided_by_attempts'
            }
        },
        receiving: {
            touchdowns: {
                h2h_points: 6,
                bonus_threshold: 4,
                bonus_points: 2,
                stat_field: 'receiving_touchdowns'
            },
            yards: {
                h2h_points: 6,
                bonus_threshold: 325,
                bonus_points: 3,
                stat_field: 'receiving_yards'
            },
            receptions: {
                h2h_points: 2,
                bonus_threshold: 30,
                bonus_points: 2,
                stat_field: 'receptions'
            },
            yards_per_reception: {
                h2h_points: 2,
                bonus_threshold: 12.00,
                bonus_points: 2,
                derived: true,
                calculation: 'yards_divided_by_receptions'
            }
        },
        kicking: {
            total_points: {
                h2h_points: 3,
                bonus_threshold: 12,
                bonus_points: 2,
                derived: true,
                calculation: 'fg_points_plus_extra_points'
            },
            fg_10_29: {
                h2h_points: 1,
                stat_field: 'fg_under_30'
            },
            fg_30_39: {
                h2h_points: 1,
                stat_field: 'fg_30_39'
            },
            fg_40_49: {
                h2h_points: 2,
                stat_field: 'fg_40_49'
            },
            fg_50_plus: {
                h2h_points: 3,
                bonus_threshold: 2,
                bonus_points: 2,
                stat_field: 'fg_50_plus'
            }
        },
        defense: {
            points_allowed: {
                h2h_points: 6,
                bonus_threshold: 14,
                bonus_points: 2,
                lower_wins: true,
                stat_field: 'points_allowed'
            },
            yards_allowed: {
                h2h_points: 3,
                bonus_threshold: 275,
                bonus_points: 2,
                lower_wins: true,
                stat_field: 'total_yards_allowed'
            },
            interceptions: {
                h2h_points: 2,
                bonus_threshold: 3,
                bonus_points: 1,
                stat_field: 'interceptions'
            },
            fumble_recoveries: {
                h2h_points: 2,
                bonus_threshold: 3,
                bonus_points: 1,
                stat_field: 'fumbles_recovered'
            },
            sacks: {
                h2h_points: 2,
                bonus_threshold: 5,
                bonus_points: 1,
                stat_field: 'sacks'
            },
            points_scored: {
                h2h_points: 5,
                bonus_threshold: 8,
                bonus_points: 2,
                derived: true,
                calculation: 'defensive_points'
            }
        },
        cumulative: {
            fewer_fumbles_lost: {
                h2h_points: 3,
                lower_wins: true,
                stat_field: 'fumbles_lost'
            },
            two_point_conversions: {
                h2h_points: 2,
                stat_field: 'two_point_conversions'
            }
        }
    },
    
    lineup_requirements: {
        quarterback: 2,
        running_back: 3,
        receiver: 3,
        place_kicker: 1,
        defense: 1,
        head_coach: 1
    },
    
    position_mappings: {
        'QB': 'quarterback',
        'RB': 'running_back',
        'RC': 'receiver',
        'WR': 'receiver',
        'TE': 'receiver',
        'PK': 'place_kicker',
        'K': 'place_kicker',
        'DEF': 'defense',
        'DST': 'defense',
        'DU': 'defense'
    },
    
    kicking_points: {
        fg_under_30: 3,
        fg_30_39: 3,
        fg_40_49: 4,
        fg_50_plus: 5,
        extra_point: 1
    },
    
    defensive_scoring: {
        touchdown: 6,
        safety: 2,
        special_teams_touchdown: 6,
        special_teams_2pt: 2
    },
    
    tiebreaker_rules: {
        use_coach_performance: true,
        coach_win_points: 2,
        coach_tie_points: 1,
        coach_loss_points: 0
    }
};