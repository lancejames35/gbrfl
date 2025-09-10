#!/usr/bin/env python3
"""
Export Final Lineup Submissions for GBRFL
Exports lineup submissions in a structured format with one row per player/position
"""

import mysql.connector
import csv
import os
from datetime import datetime

# Database configuration - PRODUCTION
DB_CONFIG = {
    'host': 'caboose.proxy.rlwy.net',
    'user': 'root',
    'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
    'database': 'railway',
    'port': 59613
}

# Output directory
OUTPUT_DIR = r'C:\Users\lance\OneDrive\LANCE\GBRFL\web'

def connect_to_database():
    """Connect to the MySQL database"""
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        print(f"✅ Connected to production database: {DB_CONFIG['host']}")
        return connection
    except mysql.connector.Error as err:
        print(f"❌ Database connection failed: {err}")
        return None

def get_locked_lineups(connection, season_year=2025, week_number=None):
    """Get lineup submissions that were locked for a specific week"""
    
    query = """
    SELECT DISTINCT
        ls.lineup_id,
        ls.fantasy_team_id,
        ft.team_name,
        ft.head_coach as team_head_coach,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name,
        u.username,
        ls.week_number,
        ls.game_type,
        ls.season_year,
        ls.head_coach as lineup_head_coach,
        ls.submitted_at,
        ls.is_locked,
        ll.lock_datetime
    FROM lineup_submissions ls
    INNER JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
    INNER JOIN users u ON ft.user_id = u.user_id
    LEFT JOIN lineup_locks ll ON (
        ls.week_number = ll.week_number 
        AND ls.season_year = ll.season_year
    )
    WHERE ls.season_year = %s
    """
    
    params = [season_year]
    
    if week_number:
        query += " AND ls.week_number = %s"
        params.append(week_number)
    
    query += """
    AND (ls.is_locked = 1 OR ll.is_locked = 1)
    ORDER BY ls.week_number, ls.game_type, ft.team_name
    """
    
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(query, params)
        results = cursor.fetchall()
        cursor.close()
        return results
    except mysql.connector.Error as err:
        print(f"❌ Failed to get locked lineups: {err}")
        return []

def get_lineup_positions(connection, lineup_id):
    """Get all player positions for a specific lineup with ESPN IDs"""
    
    query = """
    SELECT 
        lp.position_type,
        lp.sort_order,
        lp.player_id,
        lp.nfl_team_id,
        p.display_name as player_name,
        p.first_name,
        p.last_name,
        p.position as player_position,
        p.espn_id,
        COALESCE(pt.team_code, nt.team_code) as team_code,
        COALESCE(pt.team_name, nt.team_name) as team_name
    FROM lineup_positions lp
    LEFT JOIN nfl_players p ON lp.player_id = p.player_id
    LEFT JOIN nfl_teams pt ON p.nfl_team_id = pt.nfl_team_id
    LEFT JOIN nfl_teams nt ON lp.nfl_team_id = nt.nfl_team_id
    WHERE lp.lineup_id = %s
    ORDER BY 
        CASE lp.position_type
            WHEN 'quarterback' THEN 1
            WHEN 'running_back' THEN 2
            WHEN 'receiver' THEN 3
            WHEN 'place_kicker' THEN 4
            WHEN 'defense' THEN 5
        END,
        lp.sort_order
    """
    
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(query, (lineup_id,))
        results = cursor.fetchall()
        cursor.close()
        return results
    except mysql.connector.Error as err:
        print(f"❌ Failed to get lineup positions for lineup_id {lineup_id}: {err}")
        return []

def format_position_label(position_type, sort_order):
    """Format position label based on type and order"""
    position_map = {
        'quarterback': 'QB',
        'running_back': 'RB',
        'receiver': 'RC',
        'place_kicker': 'PK',
        'defense': 'DEF'
    }
    return f"{position_map.get(position_type, position_type.upper())}{sort_order}"

def export_lineups_structured(connection, season_year=2025, week_number=None):
    """Export lineup submissions in structured format with one row per player"""
    
    # Get locked lineups
    lineups = get_locked_lineups(connection, season_year, week_number)
    
    if not lineups:
        print("⚠️ No locked lineups found")
        return None
    
    print(f"📊 Found {len(lineups)} locked lineups")
    
    # Create output file name
    if week_number:
        output_file = f'lineup_submissions_week{week_number}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    else:
        output_file = f'lineup_submissions_all_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    
    output_path = os.path.join(OUTPUT_DIR, output_file)
    
    # Prepare CSV data
    csv_data = []
    
    # Create header
    header = [
        'Week', 'Game Type', 'Team ID', 'Fantasy Team Name', 
        'Owner Name', 'Username', 'Position', 'Player', 'ESPN ID'
    ]
    
    csv_data.append(header)
    
    # Process each lineup
    for lineup in lineups:
        # Base row data for this lineup
        base_row = [
            lineup['week_number'],
            lineup['game_type'],
            lineup['fantasy_team_id'],
            lineup['team_name'],
            lineup['owner_name'],
            lineup['username']
        ]
        
        # Add head coach row
        head_coach = lineup['lineup_head_coach'] if lineup['lineup_head_coach'] else lineup['team_head_coach']
        if head_coach:
            coach_row = base_row + ['HeadCoach', head_coach, '']
            csv_data.append(coach_row)
        
        # Get positions for this lineup
        positions = get_lineup_positions(connection, lineup['lineup_id'])
        
        # Add player rows
        for pos in positions:
            position_label = format_position_label(pos['position_type'], pos['sort_order'])
            
            if pos['position_type'] == 'defense':
                # For defense, use team name
                player_str = f"{pos['team_name']} ({pos['team_code']})"
                espn_id = ''
            else:
                # For players, format name with team
                player_str = f"{pos['player_name']} ({pos['team_code']})"
                espn_id = pos['espn_id'] if pos['espn_id'] else ''
            
            player_row = base_row + [position_label, player_str, espn_id]
            csv_data.append(player_row)
    
    # Write to CSV
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerows(csv_data)
    
    print(f"✅ Exported {len(csv_data)-1} rows to: {output_path}")
    
    # Print summary
    print("\n📊 Export Summary:")
    weeks = set()
    game_types = {'primary': 0, 'bonus': 0}
    teams_with_lineups = set()
    
    for lineup in lineups:
        weeks.add(lineup['week_number'])
        if lineup['game_type'] in game_types:
            game_types[lineup['game_type']] += 1
        teams_with_lineups.add(lineup['fantasy_team_id'])
    
    print(f"   Weeks included: {sorted(weeks)}")
    print(f"   Primary game lineups: {game_types.get('primary', 0)}")
    print(f"   Bonus game lineups: {game_types.get('bonus', 0)}")
    print(f"   Teams with lineups: {len(teams_with_lineups)}")
    
    return output_path

def main():
    """Main execution function"""
    print("🏈 GBRFL Lineup Submission Export Script")
    print("=" * 50)
    print("📡 Connecting to PRODUCTION database...")
    
    # Connect to database
    connection = connect_to_database()
    if not connection:
        return
    
    try:
        # Get season year
        season_year = input("Enter season year (default: 2025): ").strip()
        if not season_year:
            season_year = 2025
        else:
            season_year = int(season_year)
        
        # Get week number
        week_input = input("Enter week number (1-17, or press Enter for all weeks): ").strip()
        week_number = None
        if week_input:
            week_number = int(week_input)
            if week_number < 1 or week_number > 17:
                print("⚠️ Invalid week number. Using all weeks.")
                week_number = None
        
        if week_number:
            print(f"\n📅 Exporting lineups for Season {season_year}, Week {week_number}")
        else:
            print(f"\n📅 Exporting lineups for Season {season_year}, All Weeks")
        
        # Export lineup submissions
        print("\n📊 Exporting lineup submissions...")
        lineup_file = export_lineups_structured(connection, season_year, week_number)
        
        if lineup_file:
            print("\n✅ Export complete!")
            print(f"\n📄 File created: {lineup_file}")
            
            print("\n💡 The CSV includes:")
            print("   - One row per player/position")
            print("   - Head coaches listed as 'HeadCoach' position")
            print("   - Actual fantasy team names")
            print("   - Actual NFL player names with team codes")
            print("   - ESPN IDs in separate column")
            print("   - Both primary and bonus game lineups")
            print("\n📝 Format:")
            print("   - Position column shows: QB1, QB2, RB1, RB2, RC1, PK1, DEF1, etc.")
            print("   - Player column shows: Player Name (TEAM)")
            print("   - ESPN ID column shows the ESPN player ID (empty for defenses)")
        
    except Exception as err:
        print(f"❌ Unexpected error: {err}")
        import traceback
        traceback.print_exc()
    
    finally:
        connection.close()
        print("\n🔌 Database connection closed")

if __name__ == "__main__":
    main()
