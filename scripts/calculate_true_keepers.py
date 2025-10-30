#!/usr/bin/env python3
"""
Calculate TRUE Original Keepers
Formula: Week 1 Primary Lineup Players - Drafted Players = Original Keepers
"""

import mysql.connector
import csv
from collections import defaultdict

DB_CONFIG = {
    'host': 'caboose.proxy.rlwy.net',
    'user': 'root',
    'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
    'database': 'railway',
    'port': 59613
}

LINEUPS_CSV = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/lineups.csv'
KEEPER_DATE = '2025-08-25 14:30:48'
SEASON = 2025

# Exclude these bench players from Team 10 (extra kickers not actually keepers)
EXCLUDE_PLAYERS = {
    4360234,  # Evan McPherson
    4249087,  # Matt Gay
    3049899,  # Younghoe Koo
    4566192,  # Joshua Karty
    4567104   # Will Reichard
}

def connect_db():
    return mysql.connector.connect(**DB_CONFIG)

def get_drafted_player_ids(conn):
    """Get all player_ids from draft_picks"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT player_id
        FROM draft_picks
        WHERE season = 2025 AND player_id IS NOT NULL
    """)
    drafted_ids = {row[0] for row in cursor.fetchall()}
    cursor.close()
    print(f"   Drafted players: {len(drafted_ids)}")
    return drafted_ids

def get_espn_mapping(conn):
    """ESPN ID to player_id mapping"""
    cursor = conn.cursor()
    cursor.execute("SELECT espn_id, player_id, display_name, position FROM nfl_players WHERE espn_id IS NOT NULL")

    mapping = {}
    for espn_id, player_id, name, position in cursor.fetchall():
        mapping[str(espn_id)] = {
            'player_id': player_id,
            'name': name,
            'position': position
        }
    cursor.close()
    return mapping

def parse_week1_lineups(espn_mapping):
    """Get all Week 1 primary lineup players (excluding bench players)"""
    week1_by_team = defaultdict(list)

    with open(LINEUPS_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['Week'] == '1' and row['Game Type'] == 'primary':
                espn_id = row['ESPN ID'].strip()
                if espn_id and espn_id in espn_mapping:
                    # Skip excluded bench players
                    if int(espn_id) in EXCLUDE_PLAYERS:
                        continue

                    team_id = int(row['Team ID'])
                    player_info = espn_mapping[espn_id]
                    week1_by_team[team_id].append(player_info)

    total = sum(len(players) for players in week1_by_team.values())
    print(f"   Week 1 players (after exclusions): {total}")
    return week1_by_team

def calculate_keepers(week1_by_team, drafted_ids):
    """Calculate keepers = Week 1 - Drafted"""
    keepers_by_team = {}

    for team_id, players in week1_by_team.items():
        keepers = [p for p in players if p['player_id'] not in drafted_ids]
        keepers_by_team[team_id] = keepers

    return keepers_by_team

def generate_sql(keepers_by_team, conn):
    """Generate SQL to replace all historical_keepers"""

    # Get ESPN IDs
    cursor = conn.cursor()

    all_keepers = []
    for team_id in sorted(keepers_by_team.keys()):
        for keeper in keepers_by_team[team_id]:
            cursor.execute("SELECT espn_id FROM nfl_players WHERE player_id = %s", (keeper['player_id'],))
            result = cursor.fetchone()
            espn_id = result[0] if result and result[0] else None

            all_keepers.append({
                'team_id': team_id,
                'player_id': keeper['player_id'],
                'espn_id': espn_id,
                'name': keeper['name'],
                'position': keeper['position']
            })

    cursor.close()

    # Write SQL
    output_file = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/scripts/replace_all_keepers.sql'
    with open(output_file, 'w') as f:
        f.write("-- TRUE Original Keepers (Week 1 - Drafted)\n")
        f.write(f"-- Total: {len(all_keepers)} keepers\n\n")

        f.write("-- Step 1: Clear existing historical_keepers for 2025\n")
        f.write("DELETE FROM historical_keepers WHERE season_year = 2025;\n\n")

        f.write("-- Step 2: Insert TRUE keepers\n")
        f.write("INSERT INTO historical_keepers\n")
        f.write("  (season_year, fantasy_team_id, player_id, espn_id, designation_date)\n")
        f.write("VALUES\n")

        for i, keeper in enumerate(all_keepers):
            espn_val = keeper['espn_id'] if keeper['espn_id'] else 'NULL'
            comma = ',' if i < len(all_keepers) - 1 else ';'
            f.write(f"  ({SEASON}, {keeper['team_id']}, {keeper['player_id']}, {espn_val}, '{KEEPER_DATE}'){comma}  -- Team {keeper['team_id']}: {keeper['name']} ({keeper['position']})\n")

        f.write("\n-- Verification\n")
        f.write("SELECT fantasy_team_id, COUNT(*) as keeper_count\n")
        f.write("FROM historical_keepers WHERE season_year = 2025\n")
        f.write("GROUP BY fantasy_team_id ORDER BY fantasy_team_id;\n")

    print(f"\n✅ SQL generated: {output_file}")
    return all_keepers

def main():
    print("🔍 Calculating TRUE Original Keepers")
    print("=" * 70)
    print("Formula: Week 1 Primary Lineup - Drafted Players = Keepers")
    print("=" * 70)

    conn = connect_db()

    print("\n📊 Loading data...")
    drafted_ids = get_drafted_player_ids(conn)
    espn_mapping = get_espn_mapping(conn)
    week1_by_team = parse_week1_lineups(espn_mapping)

    print("\n🧮 Calculating keepers...")
    keepers_by_team = calculate_keepers(week1_by_team, drafted_ids)

    print("\n📋 Keeper counts by team:")
    total_keepers = 0
    for team_id in sorted(keepers_by_team.keys()):
        count = len(keepers_by_team[team_id])
        total_keepers += count
        print(f"   Team {team_id}: {count} keepers")

    print(f"\n   TOTAL KEEPERS: {total_keepers}")

    print("\n📝 Generating SQL...")
    all_keepers = generate_sql(keepers_by_team, conn)

    print("\n" + "=" * 70)
    print("✅ Complete! Review the SQL file, then execute it to replace all keepers.")
    print("=" * 70)

    conn.close()

if __name__ == "__main__":
    main()
