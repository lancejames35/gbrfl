#!/usr/bin/env python3
"""
Import Definitive Keeper List from keepers.csv
"""

import mysql.connector
import csv

DB_CONFIG = {
    'host': 'caboose.proxy.rlwy.net',
    'user': 'root',
    'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
    'database': 'railway',
    'port': 59613
}

KEEPERS_CSV = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/keepers.csv'
KEEPER_DATE = '2025-08-25 14:30:48'
SEASON = 2025

def connect_db():
    return mysql.connector.connect(**DB_CONFIG)

def import_keepers(conn):
    """Import keepers from CSV"""

    cursor = conn.cursor()

    # Clear existing keepers for 2025
    print("🗑️  Clearing existing 2025 keepers...")
    cursor.execute("DELETE FROM historical_keepers WHERE season_year = %s", (SEASON,))
    print(f"   Deleted {cursor.rowcount} existing keepers")

    # Read and import from CSV
    keepers = []
    with open(KEEPERS_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            team_id = int(row['Team ID'])
            player_id = int(row['player_id'])
            espn_id = row['ESPN ID'].strip()
            espn_id = int(espn_id) if espn_id else None

            keepers.append((SEASON, team_id, player_id, espn_id, KEEPER_DATE))

    print(f"\n📥 Importing {len(keepers)} keepers...")

    # Batch insert
    insert_query = """
        INSERT INTO historical_keepers
        (season_year, fantasy_team_id, player_id, espn_id, designation_date)
        VALUES (%s, %s, %s, %s, %s)
    """

    cursor.executemany(insert_query, keepers)
    conn.commit()

    print(f"✅ Inserted {cursor.rowcount} keepers")

    # Verify
    print("\n📊 Verification - Keepers per team:")
    cursor.execute("""
        SELECT
            hk.fantasy_team_id,
            ft.team_name,
            COUNT(*) as keeper_count
        FROM historical_keepers hk
        JOIN fantasy_teams ft ON hk.fantasy_team_id = ft.team_id
        WHERE hk.season_year = %s
        GROUP BY hk.fantasy_team_id, ft.team_name
        ORDER BY hk.fantasy_team_id
    """, (SEASON,))

    results = cursor.fetchall()
    total = 0
    for team_id, team_name, count in results:
        print(f"   Team {team_id} ({team_name}): {count} keepers")
        total += count

    print(f"\n   TOTAL: {total} keepers")

    cursor.close()
    return total

def main():
    print("🏈 Importing Definitive Keeper List")
    print("=" * 60)

    conn = connect_db()

    try:
        total = import_keepers(conn)

        print("\n" + "=" * 60)
        if total == 120:
            print("✅ SUCCESS! All 120 keepers imported correctly!")
        else:
            print(f"⚠️  WARNING: Expected 120 keepers, got {total}")
        print("=" * 60)

    finally:
        conn.close()
        print("\n🔌 Database connection closed")

if __name__ == "__main__":
    main()
