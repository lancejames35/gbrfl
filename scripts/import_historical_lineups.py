#!/usr/bin/env python3
"""
Import Historical Lineups from CSV

This script:
1. Parses all weeks (1-8) from lineups.csv
2. Matches ESPN IDs to database player_id
3. Looks up acquisition_type and was_keeper from historical_rosters
4. Inserts all lineup entries into historical_lineups table

Expected: 3,115 total lineup entries across 8 weeks, 10 teams
"""

import mysql.connector
import csv
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

def get_roster_context(connection):
    """Get acquisition context for players from historical_rosters"""
    query = """
    SELECT
        hr.fantasy_team_id,
        hr.player_id,
        hr.acquisition_type,
        hr.was_keeper
    FROM historical_rosters hr
    WHERE hr.season_year = %s
      AND hr.active_until IS NULL  -- Current/active roster entries
    """

    try:
        cursor = connection.cursor()
        cursor.execute(query, (SEASON_YEAR,))
        results = cursor.fetchall()
        cursor.close()

        # Create lookup: (team_id, player_id) -> context
        context = {}
        for team_id, player_id, acq_type, was_keeper in results:
            context[(team_id, player_id)] = {
                'acquisition_type': acq_type,
                'was_keeper': was_keeper
            }

        print(f"✅ Loaded roster context for {len(context)} team-player combinations")
        return context

    except mysql.connector.Error as err:
        print(f"❌ Failed to load roster context: {err}")
        return {}

def parse_lineups_csv(csv_path, espn_mapping):
    """Parse all weeks from lineups CSV"""

    lineup_entries = []
    missing_espn = []
    skipped_positions = defaultdict(int)

    weeks_found = set()
    teams_found = set()

    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)

            for row in reader:
                week_num = int(row['Week'])
                game_type = row['Game Type']
                team_id = int(row['Team ID'])
                team_name = row['Fantasy Team Name']
                owner_name = row['Owner Name']
                username = row['Username']
                position = row['Position']
                player_name = row['Player']
                espn_id = row['ESPN ID'].strip()

                weeks_found.add(week_num)
                teams_found.add(team_id)

                # Skip positions without ESPN IDs (HeadCoach, DEF)
                if not espn_id:
                    skipped_positions[position] += 1
                    continue

                # Look up player_id from ESPN ID
                if espn_id in espn_mapping:
                    player_info = espn_mapping[espn_id]
                    lineup_entries.append({
                        'week_number': week_num,
                        'game_type': game_type,
                        'fantasy_team_id': team_id,
                        'team_name_at_time': team_name,
                        'owner_name_at_time': owner_name,
                        'player_id': player_info['player_id'],
                        'espn_id': espn_id,
                        'player_name_at_time': player_name,
                        'position': player_info['position'],
                        'lineup_position': position
                    })
                else:
                    missing_espn.append({
                        'espn_id': espn_id,
                        'player_name': player_name,
                        'week': week_num,
                        'team_id': team_id
                    })

        print(f"✅ Parsed lineups CSV")
        print(f"   Total entries: {len(lineup_entries)}")
        print(f"   Weeks: {sorted(weeks_found)}")
        print(f"   Teams: {len(teams_found)}")

        if skipped_positions:
            print(f"   Skipped positions (no ESPN ID):")
            for pos, count in sorted(skipped_positions.items()):
                print(f"      {pos}: {count} entries")

        if missing_espn:
            print(f"⚠️  Warning: {len(missing_espn)} players not found in database")
            for player in missing_espn[:5]:
                print(f"      ESPN ID {player['espn_id']}: {player['player_name']} (Week {player['week']}, Team {player['team_id']})")
            if len(missing_espn) > 5:
                print(f"      ... and {len(missing_espn) - 5} more")

        return lineup_entries, missing_espn

    except FileNotFoundError:
        print(f"❌ CSV file not found: {csv_path}")
        return [], []
    except Exception as err:
        print(f"❌ Failed to parse CSV: {err}")
        return [], []

def insert_historical_lineups(connection, lineup_entries, roster_context):
    """Insert lineup entries into historical_lineups table"""

    inserted = 0
    skipped = 0
    errors = []

    try:
        cursor = connection.cursor()

        for entry in lineup_entries:
            team_id = entry['fantasy_team_id']
            player_id = entry['player_id']

            # Look up acquisition context
            context_key = (team_id, player_id)
            if context_key in roster_context:
                acq_type = roster_context[context_key]['acquisition_type']
                was_keeper = roster_context[context_key]['was_keeper']
            else:
                # Player not in current roster - might have been traded/dropped
                # Default to unknown
                acq_type = 'Unknown'
                was_keeper = 0

            # Insert into historical_lineups
            insert_query = """
            INSERT INTO historical_lineups
              (season_year, week_number, game_type, fantasy_team_id, team_name_at_time,
               owner_name_at_time, player_id, espn_id, player_name_at_time, position,
               lineup_position, acquisition_type, was_keeper, is_locked)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
            """

            try:
                cursor.execute(insert_query, (
                    SEASON_YEAR,
                    entry['week_number'],
                    entry['game_type'],
                    entry['fantasy_team_id'],
                    entry['team_name_at_time'],
                    entry['owner_name_at_time'],
                    entry['player_id'],
                    entry['espn_id'],
                    entry['player_name_at_time'],
                    entry['position'],
                    entry['lineup_position'],
                    acq_type,
                    was_keeper
                ))
                inserted += 1

            except mysql.connector.Error as err:
                skipped += 1
                errors.append({
                    'entry': entry,
                    'error': str(err)
                })

        connection.commit()
        cursor.close()

        print(f"✅ Inserted {inserted} lineup entries")
        if skipped > 0:
            print(f"⚠️  Skipped {skipped} entries due to errors")
            for error in errors[:5]:
                print(f"      Week {error['entry']['week_number']} Team {error['entry']['fantasy_team_id']}: {error['error']}")
            if len(errors) > 5:
                print(f"      ... and {len(errors) - 5} more errors")

        return inserted, skipped

    except mysql.connector.Error as err:
        print(f"❌ Failed to insert lineup entries: {err}")
        return 0, 0

def verify_import(connection):
    """Verify the import with summary queries"""

    queries = [
        (
            "Total lineup entries",
            "SELECT COUNT(*) FROM historical_lineups WHERE season_year = %s"
        ),
        (
            "Entries by week",
            """
            SELECT week_number, game_type, COUNT(*) as entries
            FROM historical_lineups
            WHERE season_year = %s
            GROUP BY week_number, game_type
            ORDER BY week_number, game_type
            """
        ),
        (
            "Entries by team",
            """
            SELECT
              fantasy_team_id,
              team_name_at_time,
              COUNT(*) as total_entries,
              SUM(CASE WHEN was_keeper = 1 THEN 1 ELSE 0 END) as keeper_entries
            FROM historical_lineups
            WHERE season_year = %s
            GROUP BY fantasy_team_id, team_name_at_time
            ORDER BY fantasy_team_id
            """
        )
    ]

    try:
        cursor = connection.cursor()

        for title, query in queries:
            print(f"\n📊 {title}:")
            cursor.execute(query, (SEASON_YEAR,))
            results = cursor.fetchall()

            if len(results) == 1 and len(results[0]) == 1:
                # Single value result
                print(f"   {results[0][0]}")
            else:
                # Table result
                for row in results:
                    print(f"   {row}")

        cursor.close()

    except mysql.connector.Error as err:
        print(f"❌ Verification failed: {err}")

def main():
    """Main execution function"""
    print("🏈 GBRFL Historical Lineups Import Script")
    print("=" * 60)
    print(f"Season: {SEASON_YEAR}")
    print("=" * 60)

    # Connect to database
    connection = connect_to_database()
    if not connection:
        return

    try:
        # Step 1: Get ESPN ID to player_id mapping
        print("\n📊 Step 1: Loading player mappings...")
        espn_mapping = get_espn_to_player_mapping(connection)
        if not espn_mapping:
            print("❌ Cannot proceed without player mappings")
            return

        # Step 2: Get roster context
        print("\n📊 Step 2: Loading roster context...")
        roster_context = get_roster_context(connection)

        # Step 3: Parse lineups CSV
        print("\n📊 Step 3: Parsing lineups CSV...")
        lineup_entries, missing_espn = parse_lineups_csv(LINEUPS_CSV, espn_mapping)
        if not lineup_entries:
            print("❌ Cannot proceed without lineup data")
            return

        # Step 4: Insert into historical_lineups
        print("\n📊 Step 4: Inserting lineup entries...")
        inserted, skipped = insert_historical_lineups(connection, lineup_entries, roster_context)

        # Step 5: Verify import
        print("\n📊 Step 5: Verifying import...")
        verify_import(connection)

        print("\n" + "=" * 60)
        print("✅ Historical lineups import complete!")
        print(f"   Inserted: {inserted} entries")
        print(f"   Skipped: {skipped} entries")
        print("=" * 60)

    finally:
        connection.close()
        print("\n🔌 Database connection closed")

if __name__ == "__main__":
    main()
