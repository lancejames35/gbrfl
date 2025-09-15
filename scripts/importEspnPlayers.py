#!/usr/bin/env python3
"""
Complete ESPN NFL Data Import and Team Update Script
Fetches current NFL player data from ESPN API and updates both:
1. espn_players table (current ESPN data)
2. nfl_players table (team assignments based on ESPN data)
"""

import requests
import mysql.connector
import time
import sys
import os
from datetime import datetime

# Database configuration - read from environment or use defaults
DB_CONFIG = {
    'host': 'caboose.proxy.rlwy.net',
    'port': 59613,
    'user': 'root',
    'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
    'database': 'railway'
}

# ESPN API endpoints
ESPN_TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams"
ESPN_TEAM_ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{}/roster"

# Positions we want to import
TARGET_POSITIONS = {'QB', 'RB', 'WR', 'TE', 'PK', 'K'}

def create_espn_players_table(cursor):
    """Create the espn_players table if it doesn't exist"""
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS espn_players (
        espn_id VARCHAR(20) NOT NULL PRIMARY KEY,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        display_name VARCHAR(200),
        position VARCHAR(10),
        position_full VARCHAR(50),
        position_group VARCHAR(50),
        jersey_number VARCHAR(10),
        team_id VARCHAR(10),
        team_name VARCHAR(100),
        team_abbreviation VARCHAR(10),
        height VARCHAR(20),
        weight VARCHAR(10),
        age VARCHAR(10),
        experience VARCHAR(10),
        college VARCHAR(200),
        active BOOLEAN DEFAULT TRUE,
        injured BOOLEAN DEFAULT FALSE,
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_position (position),
        INDEX idx_team_abbreviation (team_abbreviation),
        INDEX idx_display_name (display_name)
    )
    """

    cursor.execute(create_table_sql)
    print("ESPN players table created/verified")

def clear_espn_players_table(cursor):
    """Clear existing data from espn_players table"""
    cursor.execute("DELETE FROM espn_players")
    print("Cleared existing ESPN players data")

def get_nfl_teams():
    """Fetch all NFL teams from ESPN API"""
    print("Fetching NFL teams from ESPN...")

    try:
        response = requests.get(ESPN_TEAMS_URL, timeout=10)
        response.raise_for_status()
        data = response.json()

        teams = []
        sports_data = data.get('sports', [])
        if sports_data:
            leagues_data = sports_data[0].get('leagues', [])
            if leagues_data:
                teams_data = leagues_data[0].get('teams', [])

                for team in teams_data:
                    team_info = team.get('team', {})
                    teams.append({
                        'id': team_info.get('id'),
                        'abbreviation': team_info.get('abbreviation', '').upper(),
                        'displayName': team_info.get('displayName', ''),
                        'name': team_info.get('name', ''),
                        'location': team_info.get('location', '')
                    })

        print(f"Found {len(teams)} NFL teams")
        return teams

    except requests.RequestException as e:
        print(f"Error fetching teams: {e}")
        return []

def get_team_roster(team_id, team_name, team_abbreviation):
    """Fetch roster for a specific team, filter for target positions"""
    print(f"Fetching roster for {team_name}...")

    try:
        url = ESPN_TEAM_ROSTER_URL.format(team_id)
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        players = []
        athletes_groups = data.get('athletes', [])

        for group in athletes_groups:
            if not isinstance(group, dict):
                continue

            position_group = group.get('position', {})
            position_group_name = position_group.get('name', 'Unknown') if isinstance(position_group, dict) else 'Unknown'

            items = group.get('items', [])

            for player in items:
                if not isinstance(player, dict):
                    continue

                try:
                    position_info = player.get('position', {})
                    position_abbr = position_info.get('abbreviation', '') if isinstance(position_info, dict) else ''

                    # Skip if not a target position
                    if position_abbr not in TARGET_POSITIONS:
                        continue

                    # Normalize kicker position
                    if position_abbr == 'K':
                        position_abbr = 'PK'

                    experience_info = player.get('experience', {})
                    college_info = player.get('college', {})
                    status_info = player.get('status', {})

                    player_data = {
                        'espn_id': str(player.get('id', '')),
                        'first_name': player.get('firstName', ''),
                        'last_name': player.get('lastName', ''),
                        'display_name': player.get('displayName', ''),
                        'jersey_number': str(player.get('jersey', '')),
                        'position': position_abbr,
                        'position_full': position_info.get('name', '') if isinstance(position_info, dict) else '',
                        'position_group': position_group_name,
                        'team_id': str(team_id),
                        'team_name': team_name,
                        'team_abbreviation': team_abbreviation,
                        'height': str(player.get('height', '')),
                        'weight': str(player.get('weight', '')),
                        'age': str(player.get('age', '')),
                        'experience': str(experience_info.get('years', '')) if isinstance(experience_info, dict) else '',
                        'college': college_info.get('name', '') if isinstance(college_info, dict) else '',
                        'active': bool(player.get('active', True)),
                        'injured': bool(player.get('injured', False)),
                        'status': status_info.get('name', 'Active') if isinstance(status_info, dict) else 'Active'
                    }

                    # Only add if we have essential data
                    if player_data['espn_id'] and player_data['display_name'] and player_data['position']:
                        players.append(player_data)

                except Exception as player_error:
                    print(f"Error processing player in {team_name}: {player_error}")
                    continue

        filtered_count = len(players)
        print(f"Found {filtered_count} fantasy-relevant players for {team_name}")
        return players

    except requests.RequestException as e:
        print(f"Error fetching roster for {team_name}: {e}")
        return []

def insert_players_batch(cursor, players):
    """Insert a batch of players into the espn_players table"""
    if not players:
        return 0

    insert_sql = """
    INSERT INTO espn_players (
        espn_id, first_name, last_name, display_name, position, position_full,
        position_group, jersey_number, team_id, team_name, team_abbreviation,
        height, weight, age, experience, college, active, injured, status
    ) VALUES (
        %(espn_id)s, %(first_name)s, %(last_name)s, %(display_name)s, %(position)s, %(position_full)s,
        %(position_group)s, %(jersey_number)s, %(team_id)s, %(team_name)s, %(team_abbreviation)s,
        %(height)s, %(weight)s, %(age)s, %(experience)s, %(college)s, %(active)s, %(injured)s, %(status)s
    ) ON DUPLICATE KEY UPDATE
        first_name = VALUES(first_name),
        last_name = VALUES(last_name),
        display_name = VALUES(display_name),
        position = VALUES(position),
        position_full = VALUES(position_full),
        position_group = VALUES(position_group),
        jersey_number = VALUES(jersey_number),
        team_id = VALUES(team_id),
        team_name = VALUES(team_name),
        team_abbreviation = VALUES(team_abbreviation),
        height = VALUES(height),
        weight = VALUES(weight),
        age = VALUES(age),
        experience = VALUES(experience),
        college = VALUES(college),
        active = VALUES(active),
        injured = VALUES(injured),
        status = VALUES(status),
        updated_at = CURRENT_TIMESTAMP
    """

    try:
        cursor.executemany(insert_sql, players)
        return len(players)
    except mysql.connector.Error as e:
        print(f"Error inserting players: {e}")
        return 0

def update_player_teams(cursor):
    """Update nfl_players team assignments based on current ESPN data"""
    print("Updating nfl_players team assignments from ESPN data...")

    team_update_sql = """
    UPDATE nfl_players np
    LEFT JOIN espn_players ep ON np.espn_id = ep.espn_id
    LEFT JOIN nfl_teams nt ON nt.team_code = ep.team_abbreviation
    SET np.nfl_team_id = CASE
        WHEN np.position = 'DU' THEN np.nfl_team_id
        WHEN ep.espn_id IS NOT NULL AND nt.nfl_team_id IS NOT NULL THEN nt.nfl_team_id
        ELSE 33
    END
    WHERE np.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
        OR np.espn_id IS NOT NULL
    """

    try:
        cursor.execute(team_update_sql)
        affected_rows = cursor.rowcount
        print(f"Updated team assignments for {affected_rows} players")
        return affected_rows
    except mysql.connector.Error as e:
        print(f"Error updating player teams: {e}")
        return 0

def get_update_summary(cursor):
    """Get summary of the update results"""
    print("\n" + "="*50)
    print("UPDATE SUMMARY")
    print("="*50)

    # ESPN players count
    cursor.execute("SELECT COUNT(*) FROM espn_players")
    espn_count = cursor.fetchone()[0]
    print(f"ESPN players in database: {espn_count}")

    # Position breakdown
    cursor.execute("""
        SELECT position, COUNT(*) as count
        FROM espn_players
        GROUP BY position
        ORDER BY position
    """)
    position_counts = cursor.fetchall()
    print(f"\nESPN players by position:")
    for pos, count in position_counts:
        print(f"  {pos}: {count}")

    # Team assignments summary
    cursor.execute("""
        SELECT
            np.position,
            COUNT(*) as total_players,
            COUNT(CASE WHEN np.nfl_team_id = 33 THEN 1 END) as free_agents,
            COUNT(CASE WHEN np.nfl_team_id != 33 THEN 1 END) as team_players
        FROM nfl_players np
        WHERE np.position IN ('QB', 'RB', 'RC', 'PK', 'DU')
        GROUP BY np.position
        ORDER BY np.position
    """)

    team_summary = cursor.fetchall()
    print(f"\nNFL players team assignments:")
    for pos, total, fa, team in team_summary:
        print(f"  {pos}: {total} total ({team} on teams, {fa} free agents)")

def main():
    """Main function to fetch and import ESPN NFL players, then update team assignments"""
    print("ESPN NFL Data Import & Team Update Script")
    print("=" * 50)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Target positions: {', '.join(sorted(TARGET_POSITIONS))}")
    print()

    # Connect to database
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        cursor = connection.cursor()
        print("Connected to MySQL database")

        # Step 1: Create ESPN players table
        create_espn_players_table(cursor)

        # Step 2: Clear existing ESPN data
        clear_espn_players_table(cursor)
        connection.commit()

        # Step 3: Fetch and import ESPN data
        teams = get_nfl_teams()
        if not teams:
            print("Failed to fetch teams. Exiting.")
            return 1

        total_players = 0
        position_counts = {'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0, 'PK': 0}

        # Process each team
        for i, team in enumerate(teams, 1):
            print(f"\nProcessing team {i}/{len(teams)}: {team['displayName']}")

            players = get_team_roster(team['id'], team['displayName'], team['abbreviation'])

            if players:
                inserted = insert_players_batch(cursor, players)
                total_players += inserted

                # Count positions
                for player in players:
                    pos = player['position']
                    if pos in position_counts:
                        position_counts[pos] += 1

                connection.commit()
                print(f"Inserted {inserted} players from {team['displayName']}")

            # Be nice to ESPN's servers
            time.sleep(0.5)

        # Step 4: Update nfl_players team assignments
        print(f"\n" + "="*40)
        print("UPDATING TEAM ASSIGNMENTS")
        print("="*40)

        affected_rows = update_player_teams(cursor)
        connection.commit()

        # Step 5: Show summary
        get_update_summary(cursor)

        print(f"\n" + "="*50)
        print("PROCESS COMPLETED SUCCESSFULLY!")
        print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*50)

        return 0

    except mysql.connector.Error as e:
        print(f"Database error: {e}")
        return 1
    except Exception as e:
        print(f"Unexpected error: {e}")
        return 1
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'connection' in locals():
            connection.close()
        print("Database connection closed")

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)