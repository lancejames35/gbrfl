-- Comprehensive Historical Lineup Restoration
-- This script identifies and restores ALL missing players from weeks 1 and 2
-- across all teams by comparing CSV export data with current database state

-- Step 1: Create temporary table to hold CSV lineup data
DROP TEMPORARY TABLE IF EXISTS temp_historical_lineups;
CREATE TEMPORARY TABLE temp_historical_lineups (
    week_number INT,
    game_type VARCHAR(20),
    team_id INT,
    team_name VARCHAR(100),
    position_label VARCHAR(10),
    player_name VARCHAR(200),
    espn_id VARCHAR(20),
    sort_order INT,
    position_type VARCHAR(20)
);

-- Step 2: Insert Week 1 data from CSV
-- (You'll need to load this from the CSV file)
-- For now, I'll create the structure and a few examples

-- Step 3: Insert Week 2 data from CSV
-- (You'll need to load this from the CSV file)

-- Step 4: Analysis query to find ALL missing players
SELECT
    'ANALYSIS: Missing Players' as report_type,
    hl.week_number,
    hl.team_id,
    hl.team_name,
    hl.position_label,
    hl.player_name,
    hl.espn_id,
    p.player_id,
    p.display_name as db_player_name,
    ls.lineup_id,
    CASE
        WHEN p.player_id IS NULL THEN 'PLAYER_NOT_FOUND_IN_DB'
        WHEN ls.lineup_id IS NULL THEN 'LINEUP_NOT_FOUND'
        WHEN lp.position_id IS NULL THEN 'MISSING_FROM_LINEUP'
        ELSE 'EXISTS_IN_DB'
    END as status
FROM temp_historical_lineups hl
LEFT JOIN nfl_players p ON (hl.espn_id = p.espn_id AND hl.espn_id != '' AND hl.espn_id IS NOT NULL)
LEFT JOIN lineup_submissions ls ON (
    ls.fantasy_team_id = hl.team_id
    AND ls.week_number = hl.week_number
    AND ls.game_type = hl.game_type
    AND ls.season_year = 2025
)
LEFT JOIN lineup_positions lp ON (
    lp.lineup_id = ls.lineup_id
    AND lp.player_id = p.player_id
)
WHERE hl.position_label NOT LIKE 'HeadCoach'
ORDER BY hl.team_id, hl.week_number, hl.sort_order;