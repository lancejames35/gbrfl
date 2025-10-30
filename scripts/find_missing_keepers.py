#!/usr/bin/env python3
"""
Find Missing Keepers by comparing Week 1 CSV to current database
Missing keepers = Week 1 players - Drafted players - Current keepers before Aug 31
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
KEEPER_DESIGNATION_DATE = '2025-08-25 14:30:48'
SEASON_YEAR = 2025

# Expected counts from activity logs
EXPECTED_COUNTS = {
    1: 12, 2: 11, 3: 12, 4: 12, 5: 13,
    6: 12, 7: 13, 8: 12, 9: 12, 10: 11
}

def connect_db():
    return mysql.connector.connect(**DB_CONFIG)

def get_current_keepers(conn):
    """Get players acquired before draft (Aug 31)"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ftp.fantasy_team_id, ftp.player_id, np.display_name, np.espn_id, np.position
        FROM fantasy_team_players ftp
        JOIN nfl_players np ON ftp.player_id = np.player_id
        WHERE ftp.acquisition_date < '2025-08-31 00:00:00'
    """)

    keepers_by_team = defaultdict(list)
    for team_id, player_id, name, espn_id, position in cursor.fetchall():
        keepers_by_team[team_id].append({
            'player_id': player_id,
            'name': name,
            'espn_id': espn_id,
            'position': position
        })
    cursor.close()
    return keepers_by_team

def get_drafted_players(conn):
    """Get players drafted on Aug 31"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ftp.player_id, np.display_name, np.espn_id
        FROM fantasy_team_players ftp
        JOIN nfl_players np ON ftp.player_id = np.player_id
        WHERE ftp.acquisition_type = 'Draft'
    """)

    drafted = {}
    for player_id, name, espn_id in cursor.fetchall():
        drafted[player_id] = {'name': name, 'espn_id': str(espn_id) if espn_id else None}
    cursor.close()
    return drafted

def get_espn_mapping(conn):
    """Get ESPN ID to player mapping"""
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

def parse_week1_csv(espn_mapping):
    """Parse Week 1 primary lineups"""
    week1_by_team = defaultdict(list)

    with open(LINEUPS_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['Week'] == '1' and row['Game Type'] == 'primary':
                espn_id = row['ESPN ID'].strip()
                if espn_id and espn_id in espn_mapping:
                    team_id = int(row['Team ID'])
                    week1_by_team[team_id].append(espn_mapping[espn_id])

    return week1_by_team

def main():
    print("🔍 Finding Missing Keepers")
    print("=" * 60)

    conn = connect_db()

    # Get data
    print("\n📊 Loading data...")
    current_keepers = get_current_keepers(conn)
    drafted_players = get_drafted_players(conn)
    espn_mapping = get_espn_mapping(conn)
    week1_lineups = parse_week1_csv(espn_mapping)

    print(f"   Current keepers in DB: {sum(len(k) for k in current_keepers.values())}")
    print(f"   Drafted players: {len(drafted_players)}")
    print(f"   Week 1 players: {sum(len(w) for w in week1_lineups.values())}")

    # Find missing keepers per team
    print("\n🔍 Missing Keepers Analysis:")
    print("=" * 60)

    total_missing = 0
    missing_by_team = {}

    for team_id in range(1, 11):
        expected = EXPECTED_COUNTS[team_id]
        current_count = len(current_keepers[team_id])
        missing_count = expected - current_count

        if missing_count > 0:
            # Get current keeper player_ids
            current_player_ids = {k['player_id'] for k in current_keepers[team_id]}

            # Get Week 1 player_ids for this team
            week1_player_ids = {p['player_id'] for p in week1_lineups[team_id]}

            # Missing keepers = Week 1 - Current - Drafted
            potential_missing = []
            for player in week1_lineups[team_id]:
                player_id = player['player_id']
                if (player_id not in current_player_ids and
                    player_id not in drafted_players):
                    potential_missing.append(player)

            if potential_missing:
                print(f"\nTeam {team_id}: Missing {missing_count} keeper(s)")
                print(f"   Current: {current_count}, Expected: {expected}")
                print(f"   Candidates from Week 1:")
                for p in potential_missing[:missing_count]:
                    print(f"      - {p['name']} ({p['position']}) [ID: {p['player_id']}]")

                missing_by_team[team_id] = potential_missing[:missing_count]
                total_missing += len(potential_missing[:missing_count])

    # Generate INSERT statements
    print("\n" + "=" * 60)
    print(f"📝 Generating INSERT statements for {total_missing} missing keepers...")
    print("=" * 60)

    if total_missing > 0:
        output_file = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/scripts/insert_missing_keepers.sql'
        with open(output_file, 'w') as f:
            f.write("-- Insert Missing Keepers\n")
            f.write(f"-- Total: {total_missing} keepers\n\n")

            f.write("INSERT INTO historical_keepers\n")
            f.write("  (season_year, fantasy_team_id, player_id, espn_id, designation_date)\n")
            f.write("VALUES\n")

            all_missing = []
            for team_id, players in missing_by_team.items():
                for p in players:
                    all_missing.append((team_id, p))

            for i, (team_id, player) in enumerate(all_missing):
                # Look up ESPN ID
                cursor = conn.cursor()
                cursor.execute("SELECT espn_id FROM nfl_players WHERE player_id = %s", (player['player_id'],))
                result = cursor.fetchone()
                espn_id = result[0] if result and result[0] else 'NULL'
                cursor.close()

                comma = ',' if i < len(all_missing) - 1 else ';'
                f.write(f"  ({SEASON_YEAR}, {team_id}, {player['player_id']}, {espn_id}, '{KEEPER_DESIGNATION_DATE}'){comma}  -- Team {team_id}: {player['name']} ({player['position']})\n")

            f.write("\n-- Verification\n")
            f.write("SELECT fantasy_team_id, COUNT(*) FROM historical_keepers WHERE season_year = 2025 GROUP BY fantasy_team_id ORDER BY fantasy_team_id;\n")

        print(f"\n✅ SQL file generated: {output_file}")
    else:
        print("\n✅ No missing keepers found!")

    conn.close()

if __name__ == "__main__":
    main()
