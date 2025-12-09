#!/usr/bin/env python3
"""
Import historical lineups from lineups.csv into lineup_positions table
"""

import csv
import sys
import os
from decimal import Decimal
import mysql.connector
from mysql.connector import Error
from collections import defaultdict

# Add parent directory to path for config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def connect_to_db():
    """Connect to production database"""
    try:
        connection = mysql.connector.connect(
            host='caboose.proxy.rlwy.net',
            port=59613,
            user='root',
            password='JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
            database='railway'
        )
        print(f"✅ Connected to production database: caboose.proxy.rlwy.net\n")
        return connection
    except Error as e:
        print(f"❌ Error connecting to database: {e}")
        sys.exit(1)

def load_player_mappings(cursor):
    """Load ESPN ID to player_id mappings"""
    cursor.execute("SELECT player_id, espn_id, display_name, position FROM nfl_players WHERE espn_id IS NOT NULL")
    mappings = {}
    for player_id, espn_id, display_name, position in cursor.fetchall():
        mappings[espn_id] = {
            'player_id': player_id,
            'display_name': display_name,
            'position': position
        }
    print(f"✅ Loaded {len(mappings)} ESPN ID mappings\n")
    return mappings

def load_nfl_teams(cursor):
    """Load NFL team mappings"""
    cursor.execute("SELECT nfl_team_id, team_code, team_name FROM nfl_teams")
    teams_by_code = {}
    teams_by_name = {}
    for nfl_team_id, team_code, team_name in cursor.fetchall():
        teams_by_code[team_code] = nfl_team_id
        teams_by_name[team_name] = nfl_team_id
    return teams_by_code, teams_by_name

# Cache for weeks with bonus games
_weeks_with_bonus_games = {}

def check_week_has_bonus_games(cursor, week, season_year):
    """Check if a week has bonus games scheduled"""
    cache_key = f"{week}-{season_year}"
    if cache_key in _weeks_with_bonus_games:
        return _weeks_with_bonus_games[cache_key]

    cursor.execute("""
        SELECT COUNT(*) FROM weekly_schedule
        WHERE week_number = %s AND season_year = %s AND game_type = 'bonus'
    """, (week, season_year))

    result = cursor.fetchone()
    has_bonus = result[0] > 0
    _weeks_with_bonus_games[cache_key] = has_bonus
    return has_bonus

def get_or_create_lineup_submission(cursor, team_id, week, game_type, season_year):
    """Get existing lineup_submission or create one
    Returns None for bonus lineups in weeks without bonus games scheduled"""

    # Check if bonus games exist for this week before creating bonus lineup
    if game_type == 'bonus':
        if not check_week_has_bonus_games(cursor, week, season_year):
            print(f"⚠️  Skipping bonus lineup for Week {week} - no bonus games scheduled")
            return None

    cursor.execute("""
        SELECT lineup_id FROM lineup_submissions
        WHERE fantasy_team_id = %s AND week_number = %s AND game_type = %s AND season_year = %s
    """, (team_id, week, game_type, season_year))

    result = cursor.fetchone()
    if result:
        return result[0]

    # Create new lineup submission
    cursor.execute("""
        INSERT INTO lineup_submissions (fantasy_team_id, week_number, game_type, season_year, created_at)
        VALUES (%s, %s, %s, %s, NOW())
    """, (team_id, week, game_type, season_year))

    return cursor.lastrowid

def parse_position_code(position):
    """Convert position code to position_type and sort_order"""
    # HeadCoach positions
    if position == 'HeadCoach':
        return None, None  # Skip head coaches

    # Extract position type and number
    if position.startswith('QB'):
        return 'quarterback', int(position[2:]) if len(position) > 2 else 1
    elif position.startswith('RB'):
        return 'running_back', int(position[2:]) if len(position) > 2 else 1
    elif position.startswith('RC'):
        return 'receiver', int(position[2:]) if len(position) > 2 else 1
    elif position.startswith('PK'):
        return 'place_kicker', int(position[2:]) if len(position) > 2 else 1
    elif position.startswith('DEF'):
        return 'defense', int(position[3:]) if len(position) > 3 else 1

    return None, None

def extract_nfl_team_code(player_name):
    """Extract NFL team code from player name like 'Ka'imi Fairbairn (HOU)'"""
    if '(' in player_name and ')' in player_name:
        start = player_name.rfind('(')
        end = player_name.rfind(')')
        return player_name[start+1:end].strip()
    return None

def main():
    print("🏈 GBRFL Lineups Import to lineup_positions")
    print("=" * 60)
    print("Season: 2025")
    print("=" * 60)

    # Connect to database
    conn = connect_to_db()
    cursor = conn.cursor()

    # Load mappings
    print("📊 Step 1: Loading player mappings...")
    player_mappings = load_player_mappings(cursor)

    print("📊 Step 2: Loading NFL team mappings...")
    teams_by_code, teams_by_name = load_nfl_teams(cursor)
    print(f"✅ Loaded {len(teams_by_code)} NFL teams\n")

    # Parse CSV
    print("📊 Step 3: Parsing lineups CSV...")
    csv_path = '/mnt/c/Users/lance/OneDrive/LANCE/GBRFL/web/lineups.csv'

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        lineups_data = list(reader)

    print(f"✅ Parsed {len(lineups_data)} entries from CSV\n")

    # Group by lineup submission
    lineups_by_submission = defaultdict(list)
    skipped = defaultdict(int)

    for row in lineups_data:
        week = int(row['Week'])
        game_type = row['Game Type'].strip().lower()
        team_id = int(row['Team ID'])
        position = row['Position'].strip()
        player_name = row['Player'].strip()
        espn_id = row['ESPN ID'].strip()
        player_id_str = row.get('player_id', '').strip()

        # Parse position
        position_type, sort_order = parse_position_code(position)
        if not position_type:
            skipped[position] += 1
            continue

        # Determine player_id - use direct player_id if available, otherwise look up by ESPN ID
        player_id = None
        if player_id_str:
            try:
                player_id = int(player_id_str)
            except ValueError:
                pass

        # If no direct player_id, try ESPN ID lookup
        if not player_id:
            if not espn_id:
                skipped[f"{position} (no player_id or ESPN ID)"] += 1
                continue

            if espn_id not in player_mappings:
                skipped[f"Unknown ESPN ID {espn_id}"] += 1
                continue

            player_id = player_mappings[espn_id]['player_id']

        # Extract NFL team code
        nfl_team_code = extract_nfl_team_code(player_name)
        nfl_team_id = teams_by_code.get(nfl_team_code) if nfl_team_code else None

        lineups_by_submission[(team_id, week, game_type)].append({
            'position_type': position_type,
            'player_id': player_id,
            'nfl_team_id': nfl_team_id,
            'sort_order': sort_order
        })

    print(f"📊 Grouped into {len(lineups_by_submission)} lineup submissions")
    print(f"⚠️  Skipped entries: {dict(skipped)}\n")

    # Insert data
    print("📊 Step 4: Inserting lineup positions...")
    season_year = 2025
    inserted = 0
    updated_lineups = 0

    for (team_id, week, game_type), positions in lineups_by_submission.items():
        try:
            # Get or create lineup submission (returns None for bonus lineups without bonus games)
            lineup_id = get_or_create_lineup_submission(cursor, team_id, week, game_type, season_year)

            # Skip if lineup was not created (e.g., bonus lineup for week without bonus games)
            if lineup_id is None:
                continue

            # Delete existing positions for this lineup (to avoid duplicates)
            cursor.execute("DELETE FROM lineup_positions WHERE lineup_id = %s", (lineup_id,))

            # Insert positions
            for pos in positions:
                cursor.execute("""
                    INSERT INTO lineup_positions
                    (lineup_id, position_type, player_id, nfl_team_id, sort_order, created_at)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                """, (
                    lineup_id,
                    pos['position_type'],
                    pos['player_id'],
                    pos['nfl_team_id'],
                    pos['sort_order']
                ))
                inserted += 1

            updated_lineups += 1

        except Error as e:
            print(f"⚠️  Error for Team {team_id} Week {week} {game_type}: {e}")

    conn.commit()
    print(f"✅ Inserted {inserted} lineup positions across {updated_lineups} lineups\n")

    # Verification
    print("📊 Step 5: Verifying import...")

    # Check Dick Six Week 1
    cursor.execute("""
        SELECT lp.position_type, COUNT(*) as count
        FROM lineup_positions lp
        JOIN lineup_submissions ls ON lp.lineup_id = ls.lineup_id
        WHERE ls.fantasy_team_id = 1 AND ls.week_number = 1
          AND ls.game_type = 'primary' AND ls.season_year = 2025
        GROUP BY lp.position_type
    """)

    print("\n📊 Dick Six Week 1 primary lineup:")
    for position_type, count in cursor.fetchall():
        print(f"   {position_type}: {count}")

    cursor.close()
    conn.close()
    print("\n" + "=" * 60)
    print("✅ Import complete!")
    print("=" * 60)

if __name__ == '__main__':
    main()
