#!/usr/bin/env python3
"""
Export NFL Players for GBRFL Roster Assignment
Exports all players from the nfl_players table with team information
to help with roster assignment matching.
"""

import mysql.connector
import csv
import os
from datetime import datetime

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',  # Update with your MySQL username
    'password': 'Iceman3500!',  # Update with your MySQL password
    'database': 'gbrfl'
}

# Output directory
OUTPUT_DIR = r'C:\Users\lance\OneDrive\LANCE\GBRFL\web'
OUTPUT_FILE = 'exported_players.csv'

def connect_to_database():
    """Connect to the MySQL database"""
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        print(f"✅ Connected to database: {DB_CONFIG['database']}")
        return connection
    except mysql.connector.Error as err:
        print(f"❌ Database connection failed: {err}")
        return None

def export_players(connection):
    """Export all players with team information to CSV"""
    
    query = """
    SELECT 
        p.player_id,
        p.display_name,
        p.first_name,
        p.last_name,
        p.position,
        COALESCE(t.team_name, 'Free Agent') as nfl_team_name,
        COALESCE(t.team_code, 'FA') as nfl_team_code,
        p.nfl_team_id
    FROM nfl_players p
    LEFT JOIN nfl_teams t ON p.nfl_team_id = t.nfl_team_id
    ORDER BY p.position, p.display_name
    """
    
    try:
        cursor = connection.cursor()
        cursor.execute(query)
        results = cursor.fetchall()
        
        # Create output file path
        output_path = os.path.join(OUTPUT_DIR, OUTPUT_FILE)
        
        # Write to CSV
        with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            
            # Write header
            writer.writerow([
                'player_id',
                'display_name', 
                'first_name',
                'last_name',
                'position',
                'nfl_team_name',
                'nfl_team_code',
                'nfl_team_id'
            ])
            
            # Write data
            for row in results:
                writer.writerow(row)
        
        print(f"✅ Exported {len(results)} players to: {output_path}")
        
        # Print summary by position
        print("\n📊 Player Summary by Position:")
        cursor.execute("""
            SELECT position, COUNT(*) as count 
            FROM nfl_players 
            GROUP BY position 
            ORDER BY count DESC
        """)
        position_counts = cursor.fetchall()
        
        for position, count in position_counts:
            print(f"   {position}: {count} players")
        
        print(f"\n   Total: {sum(count for _, count in position_counts)} players")
        
        cursor.close()
        return output_path
        
    except mysql.connector.Error as err:
        print(f"❌ Query failed: {err}")
        return None
    except Exception as err:
        print(f"❌ Export failed: {err}")
        return None

def export_fantasy_teams(connection):
    """Export fantasy team information for reference"""
    
    query = """
    SELECT 
        ft.team_id,
        ft.team_name,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name,
        u.username
    FROM fantasy_teams ft
    JOIN users u ON ft.user_id = u.user_id
    ORDER BY ft.team_id
    """
    
    try:
        cursor = connection.cursor()
        cursor.execute(query)
        results = cursor.fetchall()
        
        # Create output file path
        teams_file = 'fantasy_teams_reference.csv'
        output_path = os.path.join(OUTPUT_DIR, teams_file)
        
        # Write to CSV
        with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            
            # Write header
            writer.writerow([
                'team_id',
                'team_name',
                'owner_name',
                'username'
            ])
            
            # Write data
            for row in results:
                writer.writerow(row)
        
        print(f"✅ Exported {len(results)} fantasy teams to: {output_path}")
        
        cursor.close()
        return output_path
        
    except mysql.connector.Error as err:
        print(f"❌ Fantasy teams query failed: {err}")
        return None

def main():
    """Main execution function"""
    print("🏈 GBRFL Player Export Script")
    print("=" * 40)
    
    # Connect to database
    connection = connect_to_database()
    if not connection:
        return
    
    try:
        # Export players
        players_file = export_players(connection)
        if players_file:
            print(f"\n📄 Players exported to: {players_file}")
        
        # Export fantasy teams for reference
        teams_file = export_fantasy_teams(connection)
        if teams_file:
            print(f"📄 Fantasy teams exported to: {teams_file}")
        
        print("\n✅ Export complete! You can now:")
        print("   1. Use exported_players.csv to match your roster assignments")
        print("   2. Reference fantasy_teams_reference.csv for team IDs")
        print("   3. Show me your roster assignment file for import script creation")
        
    finally:
        connection.close()
        print("\n🔌 Database connection closed")

if __name__ == "__main__":
    main()