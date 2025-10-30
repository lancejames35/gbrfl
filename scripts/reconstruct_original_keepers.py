#!/usr/bin/env python3
"""
Reconstruct Original 120 Keepers for 2025 Season

This script:
1. Parses lineups.csv to get all Week 1 primary game players
2. Matches ESPN IDs to database player_id
3. Identifies drafted players (acquisition_type = 'Draft')
4. Determines keepers = Week 1 players - drafted players
5. Generates INSERT statements for historical_keepers table

Based on activity_logs, we expect:
- Total: 120 keepers across 10 teams
- Team breakdown: 12,11,12,12,13,12,13,12,12,11
"""

import mysql.connector
import csv
import os
from datetime import datetime
from collections import defaultdict

# Database configuration - PRODUCTION
DB_CONFIG = {
    'host': 'caboose.proxy.rlwy.net',
    'user': 'root',
    'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
    'database': 'railway',
    'port': 59613
}

# File paths
LINEUPS_CSV = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/lineups.csv'
OUTPUT_SQL = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/scripts/insert_historical_keepers.sql'

# Keeper deadline from activity_logs
KEEPER_DESIGNATION_DATE = '2025-08-25 14:30:48'
SEASON_YEAR = 2025

def connect_to_database():
    """Connect to the MySQL database"""
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        print(f"✅ Connected to production database: {DB_CONFIG['host']}")
        return connection
    except mysql.connector.Error as err:
        print(f"❌ Database connection failed: {err}")
        return None

def get_espn_to_player_mapping(connection):
    """Get mapping of ESPN IDs to player_ids"""
    query = """
    SELECT espn_id, player_id, display_name, position
    FROM nfl_players
    WHERE espn_id IS NOT NULL
    """

    try:
        cursor = connection.cursor()
        cursor.execute(query)
        results = cursor.fetchall()
        cursor.close()

        mapping = {}
        for espn_id, player_id, display_name, position in results:
            mapping[str(espn_id)] = {
                'player_id': player_id,
                'display_name': display_name,
                'position': position
            }

        print(f"✅ Loaded {len(mapping)} ESPN ID mappings")
        return mapping

    except mysql.connector.Error as err:
        print(f"❌ Failed to load ESPN ID mappings: {err}")
        return {}

def get_keeper_players(connection):
    """Get all players that are marked as keepers (is_keeper = 1) or had acquisition_type = 'Keeper'"""
    query = """
    SELECT
        ftp.player_id,
        ftp.fantasy_team_id,
        np.espn_id,
        np.display_name,
        np.position,
        ftp.acquisition_type,
        ftp.is_keeper,
        ftp.acquisition_date
    FROM fantasy_team_players ftp
    JOIN nfl_players np ON ftp.player_id = np.player_id
    WHERE ftp.is_keeper = 1 OR ftp.acquisition_type = 'Keeper'
    ORDER BY ftp.fantasy_team_id, np.display_name
    """

    try:
        cursor = connection.cursor()
        cursor.execute(query)
        results = cursor.fetchall()
        cursor.close()

        keeper_map = {}  # player_id -> details
        keepers_by_team = defaultdict(list)

        for player_id, team_id, espn_id, display_name, position, acq_type, is_keeper, acq_date in results:
            keeper_info = {
                'player_id': player_id,
                'team_id': team_id,
                'espn_id': espn_id,
                'display_name': display_name,
                'position': position,
                'acquisition_type': acq_type,
                'is_keeper': is_keeper,
                'acquisition_date': acq_date
            }
            keeper_map[player_id] = keeper_info
            keepers_by_team[team_id].append(keeper_info)

        print(f"✅ Found {len(keeper_map)} current keepers in database")
        print(f"   Breakdown by team:")
        for team_id in sorted(keepers_by_team.keys()):
            print(f"      Team {team_id}: {len(keepers_by_team[team_id])} keepers")

        return keeper_map, keepers_by_team

    except mysql.connector.Error as err:
        print(f"❌ Failed to query keeper players: {err}")
        return {}, {}

def parse_week1_lineups(csv_path, espn_mapping):
    """Parse CSV to extract Week 1 primary game lineups"""

    week1_players = defaultdict(list)  # team_id -> list of player info
    missing_espn_ids = []
    skipped_positions = set()

    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)

            for row in reader:
                # Only process Week 1 primary game
                if row['Week'] != '1' or row['Game Type'] != 'primary':
                    continue

                espn_id = row['ESPN ID'].strip()
                team_id = int(row['Team ID'])
                position = row['Position']
                player_name = row['Player']

                # Skip positions without ESPN IDs (HeadCoach, DEF)
                if not espn_id:
                    skipped_positions.add(position)
                    continue

                # Look up player_id from ESPN ID
                if espn_id in espn_mapping:
                    player_info = espn_mapping[espn_id]
                    week1_players[team_id].append({
                        'player_id': player_info['player_id'],
                        'espn_id': espn_id,
                        'display_name': player_info['display_name'],
                        'position': player_info['position'],
                        'team_id': team_id
                    })
                else:
                    missing_espn_ids.append({
                        'espn_id': espn_id,
                        'player_name': player_name,
                        'team_id': team_id,
                        'position': position
                    })

        print(f"✅ Parsed Week 1 lineups from CSV")
        print(f"   Total Week 1 players: {sum(len(players) for players in week1_players.values())}")
        print(f"   Teams: {len(week1_players)}")

        if skipped_positions:
            print(f"   Skipped positions (no ESPN ID): {', '.join(sorted(skipped_positions))}")

        if missing_espn_ids:
            print(f"⚠️  Warning: {len(missing_espn_ids)} players not found in database:")
            for player in missing_espn_ids[:5]:  # Show first 5
                print(f"      ESPN ID {player['espn_id']}: {player['player_name']} (Team {player['team_id']})")
            if len(missing_espn_ids) > 5:
                print(f"      ... and {len(missing_espn_ids) - 5} more")

        return week1_players, missing_espn_ids

    except FileNotFoundError:
        print(f"❌ CSV file not found: {csv_path}")
        return {}, []
    except Exception as err:
        print(f"❌ Failed to parse CSV: {err}")
        return {}, []

def identify_keepers(keeper_map):
    """Organize keepers by team from database"""

    keepers_by_team = defaultdict(list)

    for player_id, keeper_info in keeper_map.items():
        keepers_by_team[keeper_info['team_id']].append(keeper_info)

    total_keepers = len(keeper_map)

    print(f"\n✅ Organized {total_keepers} keepers by team")

    return keepers_by_team

def generate_insert_sql(keepers_by_team, output_file):
    """Generate SQL INSERT statements for historical_keepers"""

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("-- Historical Keepers INSERT Script\n")
            f.write("-- Generated: {}\n".format(datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            f.write("-- Total Keepers: {}\n\n".format(
                sum(len(keepers) for keepers in keepers_by_team.values())
            ))

            f.write("-- Insert original 120 keepers from 2025 season start\n")
            f.write("INSERT INTO historical_keepers\n")
            f.write("  (season_year, fantasy_team_id, player_id, espn_id, designation_date)\n")
            f.write("VALUES\n")

            all_keepers = []
            for team_id in sorted(keepers_by_team.keys()):
                for keeper in keepers_by_team[team_id]:
                    all_keepers.append(keeper)

            # Generate VALUES statements
            values_lines = []
            for i, keeper in enumerate(all_keepers):
                espn_id_value = f"{keeper['espn_id']}" if keeper['espn_id'] is not None else "NULL"
                line = f"  ({SEASON_YEAR}, {keeper['team_id']}, {keeper['player_id']}, {espn_id_value}, '{KEEPER_DESIGNATION_DATE}')"
                if i < len(all_keepers) - 1:
                    line += ","
                else:
                    line += ";"

                # Add comment with player name
                line += f"  -- Team {keeper['team_id']}: {keeper['display_name']} ({keeper['position']})"
                values_lines.append(line)

            f.write('\n'.join(values_lines))
            f.write('\n\n')

            # Add verification query
            f.write("-- Verification query\n")
            f.write("SELECT\n")
            f.write("    ft.team_name,\n")
            f.write("    COUNT(*) as keeper_count\n")
            f.write("FROM historical_keepers hk\n")
            f.write("JOIN fantasy_teams ft ON hk.fantasy_team_id = ft.team_id\n")
            f.write("WHERE hk.season_year = 2025\n")
            f.write("GROUP BY ft.team_name\n")
            f.write("ORDER BY ft.team_id;\n")
            f.write("-- Expected: 12,11,12,12,13,12,13,12,12,11 = 120 total\n")

        print(f"\n✅ Generated SQL file: {output_file}")
        return True

    except Exception as err:
        print(f"❌ Failed to generate SQL file: {err}")
        return False

def generate_detailed_report(keepers_by_team, output_dir):
    """Generate a detailed CSV report of keepers for review"""

    report_file = os.path.join(output_dir, 'keeper_reconstruction_report.csv')

    try:
        with open(report_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)

            # Write header
            writer.writerow([
                'Team ID',
                'Player ID',
                'ESPN ID',
                'Player Name',
                'Position',
                'Is Keeper',
                'Acquisition Type',
                'Acquisition Date'
            ])

            # Write keepers
            for team_id in sorted(keepers_by_team.keys()):
                for keeper in keepers_by_team[team_id]:
                    writer.writerow([
                        team_id,
                        keeper['player_id'],
                        keeper['espn_id'],
                        keeper['display_name'],
                        keeper['position'],
                        'Yes' if keeper['is_keeper'] else 'No',
                        keeper['acquisition_type'],
                        keeper['acquisition_date']
                    ])

        print(f"✅ Generated report: {report_file}")
        return True

    except Exception as err:
        print(f"❌ Failed to generate report: {err}")
        return False

def main():
    """Main execution function"""
    print("🏈 GBRFL Keeper Reconstruction Script")
    print("=" * 60)
    print(f"Season: {SEASON_YEAR}")
    print(f"Keeper Designation Date: {KEEPER_DESIGNATION_DATE}")
    print("=" * 60)

    # Connect to database
    connection = connect_to_database()
    if not connection:
        return

    try:
        # Step 1: Get current keeper players from database
        print("\n📊 Step 1: Loading current keepers from database...")
        keeper_map, keepers_by_team_db = get_keeper_players(connection)
        if not keeper_map:
            print("❌ Cannot proceed without keeper data")
            return

        # Step 2: Organize keepers by team
        print("\n📊 Step 2: Organizing keepers by team...")
        keepers_by_team = identify_keepers(keeper_map)

        # Step 3: Generate SQL insert statements
        print("\n📊 Step 3: Generating SQL INSERT statements...")
        output_dir = os.path.dirname(OUTPUT_SQL)
        if generate_insert_sql(keepers_by_team, OUTPUT_SQL):
            print(f"\n✅ SQL file ready: {OUTPUT_SQL}")
            print("\n📋 Next steps:")
            print("   1. Review the SQL file")
            print("   2. Execute it against the database")
            print("   3. Run verification query to confirm keeper counts")

        # Step 4: Generate detailed report
        print("\n📊 Step 4: Generating detailed report...")
        generate_detailed_report(keepers_by_team, output_dir)

        print("\n" + "=" * 60)
        print("✅ Keeper reconstruction complete!")
        print("=" * 60)

    finally:
        connection.close()
        print("\n🔌 Database connection closed")

if __name__ == "__main__":
    main()
