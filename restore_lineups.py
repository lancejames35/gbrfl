#!/usr/bin/env python3
"""
Historical Lineup Restoration Script
Compares CSV lineup files with database and generates SQL to restore missing players
"""

import csv
import mysql.connector
import os
from datetime import datetime

# Database connection (you'll need to adjust these)
DB_CONFIG = {
    'host': 'localhost',
    'user': 'your_db_user',
    'password': 'your_db_password',
    'database': 'railway'
}

def load_csv_lineups(filename):
    """Load lineup data from CSV file"""
    lineups = []
    with open(filename, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            if row['Position'] not in ['HeadCoach']:  # Skip head coaches
                lineups.append({
                    'week': int(row['Week']),
                    'game_type': row['Game Type'],
                    'team_id': int(row['Team ID']),
                    'team_name': row['Fantasy Team Name'],
                    'position': row['Position'],
                    'player_name': row['Player'],
                    'espn_id': row['ESPN ID'].strip() if row['ESPN ID'] else None
                })
    return lineups

def get_db_connection():
    """Create database connection"""
    return mysql.connector.connect(**DB_CONFIG)

def find_missing_players(csv_lineups):
    """Find players that exist in CSV but missing from database lineup_positions"""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    missing_players = []

    for lineup in csv_lineups:
        if not lineup['espn_id']:  # Skip players without ESPN ID (like defenses)
            continue

        # Find player in database
        cursor.execute("""
            SELECT player_id, display_name
            FROM nfl_players
            WHERE espn_id = %s
        """, (lineup['espn_id'],))

        player = cursor.fetchone()
        if not player:
            print(f"WARNING: Player not found in DB: {lineup['player_name']} (ESPN: {lineup['espn_id']})")
            continue

        # Find lineup submission
        cursor.execute("""
            SELECT lineup_id
            FROM lineup_submissions
            WHERE fantasy_team_id = %s
            AND week_number = %s
            AND game_type = %s
            AND season_year = 2025
            ORDER BY lineup_id LIMIT 1
        """, (lineup['team_id'], lineup['week'], lineup['game_type']))

        lineup_sub = cursor.fetchone()
        if not lineup_sub:
            print(f"WARNING: No lineup submission found for team {lineup['team_id']} week {lineup['week']}")
            continue

        # Check if player is already in lineup_positions
        cursor.execute("""
            SELECT position_id
            FROM lineup_positions
            WHERE lineup_id = %s
            AND player_id = %s
        """, (lineup_sub['lineup_id'], player['player_id']))

        existing = cursor.fetchone()
        if existing:
            continue  # Player already exists, skip

        # Player is missing! Add to restoration list
        missing_players.append({
            'lineup_id': lineup_sub['lineup_id'],
            'player_id': player['player_id'],
            'player_name': player['display_name'],
            'team_id': lineup['team_id'],
            'team_name': lineup['team_name'],
            'week': lineup['week'],
            'position': lineup['position'],
            'espn_id': lineup['espn_id']
        })

        print(f"MISSING: {lineup['team_name']} Week {lineup['week']} - {player['display_name']} ({lineup['position']})")

    cursor.close()
    conn.close()
    return missing_players

def generate_restoration_sql(missing_players):
    """Generate SQL script to restore missing lineup positions"""

    sql_script = """-- Historical Lineup Restoration Script
-- Generated on {timestamp}
-- Restores missing lineup_positions for weeks 1 and 2

""".format(timestamp=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

    # Map positions to sort orders and position types
    position_mapping = {
        'QB1': ('quarterback', 1), 'QB2': ('quarterback', 2), 'QB3': ('quarterback', 3),
        'QB4': ('quarterback', 4), 'QB5': ('quarterback', 5),
        'QB': ('quarterback', 1),  # Week 2 format

        'RB1': ('running_back', 1), 'RB2': ('running_back', 2), 'RB3': ('running_back', 3),
        'RB4': ('running_back', 4), 'RB5': ('running_back', 5), 'RB6': ('running_back', 6),
        'RB': ('running_back', 1),  # Week 2 format

        'RC1': ('receiver', 1), 'RC2': ('receiver', 2), 'RC3': ('receiver', 3),
        'RC4': ('receiver', 4), 'RC5': ('receiver', 5), 'RC6': ('receiver', 6), 'RC7': ('receiver', 7),
        'RC': ('receiver', 1),  # Week 2 format

        'PK1': ('place_kicker', 1), 'PK': ('place_kicker', 1),
        'DEF1': ('defense', 1), 'DEF2': ('defense', 2), 'DEF': ('defense', 1)
    }

    for player in missing_players:
        position_type, sort_order = position_mapping.get(player['position'], ('other', 1))

        sql_script += f"""-- Restore {player['player_name']} for {player['team_name']} Week {player['week']}
INSERT INTO lineup_positions (
    lineup_id, position_type, player_id, sort_order, created_at
) VALUES (
    {player['lineup_id']},
    '{position_type}',
    {player['player_id']},
    {sort_order},
    '2025-09-04 16:07:27'  -- Use original timestamp
);

"""

    return sql_script

def main():
    """Main execution function"""
    print("Historical Lineup Restoration Tool")
    print("=" * 50)

    # Load CSV files
    week1_lineups = load_csv_lineups('lineup_submissions_week1_20250909_094058.csv')
    week2_lineups = load_csv_lineups('lineup_submissions_week2_20250916_095641.csv')

    all_lineups = week1_lineups + week2_lineups
    print(f"Loaded {len(all_lineups)} lineup entries from CSV files")

    # Find missing players
    missing_players = find_missing_players(all_lineups)
    print(f"\nFound {len(missing_players)} missing players")

    if missing_players:
        # Generate restoration SQL
        sql_script = generate_restoration_sql(missing_players)

        # Write to file
        with open('restore_missing_lineups.sql', 'w', encoding='utf-8') as f:
            f.write(sql_script)

        print(f"\nRestoration script written to: restore_missing_lineups.sql")
        print("\nMissing players summary:")
        for player in missing_players:
            print(f"  - {player['team_name']} Week {player['week']}: {player['player_name']} ({player['position']})")
    else:
        print("\nNo missing players found - all historical lineups are complete!")

if __name__ == "__main__":
    main()