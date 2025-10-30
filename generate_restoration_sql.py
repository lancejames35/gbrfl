#!/usr/bin/env python3
"""
Comprehensive Historical Lineup Restoration Generator
Reads CSV files and generates SQL to restore all missing historical lineup data
"""

import csv
import re

def parse_position_info(position_label):
    """Parse position label to get position type and sort order"""
    position_mapping = {
        # Week 1 format (QB1, QB2, etc.)
        'QB': ('quarterback', r'QB(\d+)', lambda m: int(m.group(1))),
        'RB': ('running_back', r'RB(\d+)', lambda m: int(m.group(1))),
        'RC': ('receiver', r'RC(\d+)', lambda m: int(m.group(1))),
        'PK': ('place_kicker', r'PK(\d+)', lambda m: int(m.group(1))),
        'DEF': ('defense', r'DEF(\d+)', lambda m: int(m.group(1))),

        # Week 2 format (QB, RB, etc.) - need to count occurrences
        'QB_SIMPLE': ('quarterback', r'^QB$', None),
        'RB_SIMPLE': ('running_back', r'^RB$', None),
        'RC_SIMPLE': ('receiver', r'^RC$', None),
        'PK_SIMPLE': ('place_kicker', r'^PK$', None),
        'DEF_SIMPLE': ('defense', r'^DEF$', None),
    }

    # Try numbered format first
    for pos_type, (db_type, pattern, sort_func) in position_mapping.items():
        if 'SIMPLE' not in pos_type:
            match = re.match(pattern, position_label)
            if match and sort_func:
                return db_type, sort_func(match)

    # Handle simple format (QB, RB, etc.) - will need context to determine sort_order
    simple_mapping = {
        'QB': 'quarterback',
        'RB': 'running_back',
        'RC': 'receiver',
        'PK': 'place_kicker',
        'DEF': 'defense'
    }

    if position_label in simple_mapping:
        return simple_mapping[position_label], 1  # Default to 1, will fix with context

    return 'other', 1

def load_csv_with_sort_order(filename):
    """Load CSV and calculate correct sort orders for each position type"""
    lineups = []
    position_counters = {}  # Track sort order per team/week/position

    with open(filename, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            if row['Position'] == 'HeadCoach':
                continue

            team_id = int(row['Team ID'])
            week = int(row['Week'])
            position_label = row['Position']

            position_type, sort_order = parse_position_info(position_label)

            # For simple format (Week 2), calculate sort order based on occurrence
            if position_label in ['QB', 'RB', 'RC', 'PK', 'DEF']:
                key = f"{team_id}_{week}_{position_type}"
                position_counters[key] = position_counters.get(key, 0) + 1
                sort_order = position_counters[key]

            lineups.append({
                'week': week,
                'game_type': row['Game Type'],
                'team_id': team_id,
                'team_name': row['Fantasy Team Name'],
                'position_label': position_label,
                'player_name': row['Player'],
                'espn_id': row['ESPN ID'].strip() if row['ESPN ID'] else '',
                'position_type': position_type,
                'sort_order': sort_order
            })

    return lineups

def generate_restoration_sql():
    """Generate complete restoration SQL from CSV files"""

    print("Loading CSV files...")
    week1_lineups = load_csv_with_sort_order('lineup_submissions_week1_20250909_094058.csv')
    week2_lineups = load_csv_with_sort_order('lineup_submissions_week2_20250916_095641.csv')

    all_lineups = week1_lineups + week2_lineups
    print(f"Loaded {len(all_lineups)} total lineup entries")

    # Generate SQL
    sql_content = f"""-- Comprehensive Historical Lineup Restoration
-- Generated from CSV files: lineup_submissions_week1_20250909_094058.csv, lineup_submissions_week2_20250916_095641.csv
-- Total entries: {len(all_lineups)}

-- Create temporary table for analysis
DROP TEMPORARY TABLE IF EXISTS temp_csv_lineups;
CREATE TEMPORARY TABLE temp_csv_lineups (
    week_number INT,
    game_type VARCHAR(20),
    team_id INT,
    team_name VARCHAR(100),
    position_label VARCHAR(10),
    player_name VARCHAR(200),
    espn_id VARCHAR(20),
    position_type VARCHAR(20),
    sort_order INT
);

-- Insert all CSV data
INSERT INTO temp_csv_lineups VALUES
"""

    # Add all lineup entries
    values = []
    for lineup in all_lineups:
        # Escape single quotes in player names
        player_name = lineup['player_name'].replace("'", "\\'")
        team_name = lineup['team_name'].replace("'", "\\'")

        values.append(f"({lineup['week']}, '{lineup['game_type']}', {lineup['team_id']}, '{team_name}', '{lineup['position_label']}', '{player_name}', '{lineup['espn_id']}', '{lineup['position_type']}', {lineup['sort_order']})")

    sql_content += ",\n".join(values) + ";\n\n"

    # Add analysis and restoration logic
    sql_content += """-- Find all missing players
SELECT
    'MISSING_PLAYER' as status,
    csv.week_number,
    csv.team_id,
    csv.team_name,
    csv.position_label,
    csv.player_name,
    csv.espn_id,
    p.player_id,
    ls.lineup_id,
    csv.position_type,
    csv.sort_order
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
WHERE p.player_id IS NOT NULL      -- Player exists in database
  AND ls.lineup_id IS NOT NULL     -- Lineup exists
  AND lp.position_id IS NULL       -- But position is missing
ORDER BY csv.team_id, csv.week_number, csv.sort_order;

-- Generate restoration script
-- You can save the results of the above query and create INSERT statements like:
/*
Example restoration for each missing player:

INSERT INTO lineup_positions (
    lineup_id, position_type, player_id, sort_order, created_at
) VALUES (
    [lineup_id], '[position_type]', [player_id], [sort_order],
    CASE
        WHEN [week_number] = 1 THEN '2025-09-04 16:07:27'
        WHEN [week_number] = 2 THEN '2025-09-11 16:07:27'
    END
);
*/

-- Clean up
DROP TEMPORARY TABLE temp_csv_lineups;
"""

    return sql_content

def main():
    """Main execution"""
    try:
        sql_content = generate_restoration_sql()

        with open('historical_lineup_restoration.sql', 'w', encoding='utf-8') as f:
            f.write(sql_content)

        print("✅ Generated: historical_lineup_restoration.sql")
        print("\nNext steps:")
        print("1. Run the SQL file to analyze missing players")
        print("2. Review the results to see which players are missing")
        print("3. Generate INSERT statements for the missing players")

    except FileNotFoundError as e:
        print(f"❌ Error: Could not find CSV file - {e}")
        print("Make sure both CSV files are in the current directory:")
        print("  - lineup_submissions_week1_20250909_094058.csv")
        print("  - lineup_submissions_week2_20250916_095641.csv")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()