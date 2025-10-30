-- Historical Lineup Data Restoration Script
-- This script restores missing lineup_positions data for weeks 1 and 2
-- by comparing CSV export data with current database state

-- First, let's create a temporary table to hold the CSV data for analysis
DROP TEMPORARY TABLE IF EXISTS temp_csv_lineups;
CREATE TEMPORARY TABLE temp_csv_lineups (
    week_number INT,
    game_type VARCHAR(10),
    team_id INT,
    team_name VARCHAR(100),
    position_label VARCHAR(10),
    player_name VARCHAR(100),
    espn_id VARCHAR(20)
);

-- Week 1 data from CSV (sample - you'll need to add all rows)
INSERT INTO temp_csv_lineups VALUES
-- Team 1 (Dick Six) Week 1
(1, 'primary', 1, 'Dick Six', 'QB1', 'Jalen Hurts (PHI)', '4040715'),
(1, 'primary', 1, 'Dick Six', 'QB2', 'Joe Flacco (CLE)', '11252'),
(1, 'primary', 1, 'Dick Six', 'QB3', 'Jalen Milroe (SEA)', '4432734'),
(1, 'primary', 1, 'Dick Six', 'QB4', 'Will Howard (PIT)', '4429955'),
(1, 'primary', 1, 'Dick Six', 'QB5', 'Tyler Shough (NO)', '4360689'),
(1, 'primary', 1, 'Dick Six', 'RB1', 'James Cook (BUF)', '4379399'),
(1, 'primary', 1, 'Dick Six', 'RB2', 'Chase Brown (CIN)', '4362238'),
(1, 'primary', 1, 'Dick Six', 'RB3', 'Tony Pollard (TEN)', '3916148'),
(1, 'primary', 1, 'Dick Six', 'RB4', 'Jaylen Warren (PIT)', '4569987'),
(1, 'primary', 1, 'Dick Six', 'RB5', 'Ollie Gordon II (MIA)', '4711533'),
(1, 'primary', 1, 'Dick Six', 'RB6', 'MarShawn Lloyd (GB)', '4429023'),
(1, 'primary', 1, 'Dick Six', 'RC1', 'Brock Bowers (LV)', '4432665'),
(1, 'primary', 1, 'Dick Six', 'RC2', 'DeVonta Smith (PHI)', '4241478'),
(1, 'primary', 1, 'Dick Six', 'RC3', 'Josh Downs (IND)', '4688813'),
(1, 'primary', 1, 'Dick Six', 'RC4', 'Jayden Higgins (HOU)', '4877706'),
(1, 'primary', 1, 'Dick Six', 'RC5', 'Tre\' Harris (LAC)', '4686612'),  -- This is the missing one!
(1, 'primary', 1, 'Dick Six', 'RC6', 'Jordan Addison (MIN)', '4429205'),
(1, 'primary', 1, 'Dick Six', 'RC7', 'Chris Godwin (TB)', '3116165'),
(1, 'primary', 1, 'Dick Six', 'PK1', 'Ka\'imi Fairbairn (HOU)', '2971573'),
(1, 'primary', 1, 'Dick Six', 'DEF1', 'Washington Commanders (WSH)', ''),
(1, 'primary', 1, 'Dick Six', 'DEF2', 'Detroit Lions (DET)', '');

-- Analysis query to find missing players
SELECT
    'MISSING FROM DATABASE' as status,
    csv.week_number,
    csv.team_id,
    csv.team_name,
    csv.position_label,
    csv.player_name,
    csv.espn_id,
    p.player_id,
    p.display_name as db_player_name,
    ls.lineup_id
FROM temp_csv_lineups csv
LEFT JOIN nfl_players p ON (csv.espn_id = p.espn_id AND csv.espn_id != '')
LEFT JOIN lineup_submissions ls ON (
    ls.fantasy_team_id = csv.team_id
    AND ls.week_number = csv.week_number
    AND ls.game_type = csv.game_type
    AND ls.season_year = 2025
)
LEFT JOIN lineup_positions lp ON (
    lp.lineup_id = ls.lineup_id
    AND lp.player_id = p.player_id
)
WHERE p.player_id IS NOT NULL  -- Player exists in database
AND ls.lineup_id IS NOT NULL   -- Lineup exists
AND lp.position_id IS NULL     -- But lineup position is missing
ORDER BY csv.team_id, csv.week_number, csv.position_label;