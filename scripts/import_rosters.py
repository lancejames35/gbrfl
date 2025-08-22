#!/usr/bin/env python3
"""
Import GBRFL Fantasy Team Rosters
Reads rosters.csv with player_name_id values and imports to fantasy_team_players table
"""

import mysql.connector
import csv
import os
from datetime import datetime
from collections import defaultdict, Counter

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',  # Update with your MySQL username
    'password': 'Iceman3500!',  # Update with your MySQL password
    'database': 'gbrfl'
}

# File path
ROSTERS_FILE = r'C:\Users\lance\OneDrive\LANCE\GBRFL\web\uploads\rosters.csv'

class RosterImporter:
    def __init__(self):
        self.connection = None
        self.rosters = []
        self.stats = defaultdict(int)
        self.errors = []
        self.team_counts = defaultdict(int)
        self.position_counts = defaultdict(int)

    def connect_to_database(self):
        """Connect to the MySQL database"""
        try:
            self.connection = mysql.connector.connect(**DB_CONFIG)
            print(f"✅ Connected to database: {DB_CONFIG['database']}")
            return True
        except mysql.connector.Error as err:
            print(f"❌ Database connection failed: {err}")
            return False

    def validate_file(self):
        """Check if the rosters file exists and is readable"""
        if not os.path.exists(ROSTERS_FILE):
            print(f"❌ Rosters file not found: {ROSTERS_FILE}")
            return False
        
        print(f"✅ Found rosters file: {ROSTERS_FILE}")
        return True

    def load_rosters(self):
        """Load and validate roster data from CSV"""
        print(f"\n📄 Loading rosters from CSV...")
        
        try:
            with open(ROSTERS_FILE, 'r', encoding='utf-8') as csvfile:
                reader = csv.DictReader(csvfile)
                
                for row_num, row in enumerate(reader, 2):  # Start at 2 for header
                    try:
                        # Parse and validate row data
                        # Handle is_keeper as TRUE/FALSE or 1/0
                        is_keeper_value = row['is_keeper'].strip().upper()
                        if is_keeper_value in ['TRUE', '1']:
                            is_keeper = True
                        elif is_keeper_value in ['FALSE', '0']:
                            is_keeper = False
                        else:
                            raise ValueError(f"Invalid is_keeper value: {row['is_keeper']}")
                        
                        roster_entry = {
                            'row_num': row_num,
                            'team_name': row['team_name'].strip(),
                            'team_name_id': int(row['team_name_id']),
                            'player_name_id': int(row['player_name_id']),
                            'position': row['position'].strip().upper(),
                            'is_keeper': is_keeper,
                            'acquisition_type': row['acquisition_type'].strip()
                        }
                        
                        # Basic validation
                        if not (1 <= roster_entry['team_name_id'] <= 10):
                            self.errors.append(f"Row {row_num}: Invalid team_name_id {roster_entry['team_name_id']}")
                            continue
                            
                        if roster_entry['player_name_id'] <= 0:
                            self.errors.append(f"Row {row_num}: Invalid player_name_id {roster_entry['player_name_id']}")
                            continue
                            
                        if roster_entry['position'] not in ['QB', 'RB', 'RC', 'PK', 'DU']:
                            self.errors.append(f"Row {row_num}: Invalid position '{roster_entry['position']}'")
                            continue
                            
                        if roster_entry['acquisition_type'] not in ['Draft', 'Keeper', 'Trade', 'Free Agent']:
                            self.errors.append(f"Row {row_num}: Invalid acquisition_type '{roster_entry['acquisition_type']}'")
                            continue
                        
                        self.rosters.append(roster_entry)
                        self.team_counts[roster_entry['team_name']] += 1
                        self.position_counts[roster_entry['position']] += 1
                        self.stats['rows_loaded'] += 1
                        
                    except (ValueError, KeyError) as e:
                        self.errors.append(f"Row {row_num}: Data parsing error - {str(e)}")
                        continue
            
            print(f"✅ Loaded {self.stats['rows_loaded']} roster entries")
            
            if self.errors:
                print(f"⚠️  Found {len(self.errors)} validation errors")
                for error in self.errors[:10]:  # Show first 10 errors
                    print(f"   {error}")
                if len(self.errors) > 10:
                    print(f"   ... and {len(self.errors) - 10} more errors")
                return False
            
            return True
            
        except Exception as e:
            print(f"❌ Failed to load rosters file: {str(e)}")
            return False

    def validate_database_references(self):
        """Validate that all team_name_id and player_name_id values exist in database"""
        print(f"\n🔍 Validating database references...")
        
        cursor = self.connection.cursor()
        
        # Check fantasy team IDs
        team_ids = set(roster['team_name_id'] for roster in self.rosters)
        placeholders = ','.join(['%s'] * len(team_ids))
        cursor.execute(f"SELECT team_id FROM fantasy_teams WHERE team_id IN ({placeholders})", list(team_ids))
        valid_team_ids = set(row[0] for row in cursor.fetchall())
        
        missing_teams = team_ids - valid_team_ids
        if missing_teams:
            print(f"❌ Missing fantasy team IDs: {missing_teams}")
            return False
        
        # Check player IDs
        player_ids = set(roster['player_name_id'] for roster in self.rosters)
        placeholders = ','.join(['%s'] * len(player_ids))
        cursor.execute(f"SELECT player_id FROM nfl_players WHERE player_id IN ({placeholders})", list(player_ids))
        valid_player_ids = set(row[0] for row in cursor.fetchall())
        
        missing_players = player_ids - valid_player_ids
        if missing_players:
            print(f"❌ Missing player IDs: {sorted(missing_players)}")
            return False
        
        # Check for duplicate player assignments
        player_id_counts = Counter(roster['player_name_id'] for roster in self.rosters)
        duplicates = [(pid, count) for pid, count in player_id_counts.items() if count > 1]
        if duplicates:
            print(f"❌ Duplicate player assignments found:")
            for player_id, count in duplicates[:5]:  # Show first 5
                print(f"   Player ID {player_id}: assigned {count} times")
            return False
        
        cursor.close()
        print(f"✅ All database references are valid")
        return True

    def print_summary(self):
        """Print pre-import summary"""
        print(f"\n" + "="*60)
        print(f"📊 ROSTER IMPORT SUMMARY")
        print(f"="*60)
        
        print(f"📄 Total entries to import: {len(self.rosters)}")
        print(f"👥 Fantasy teams: {len(set(r['team_name_id'] for r in self.rosters))}")
        print(f"🏈 Unique players: {len(set(r['player_name_id'] for r in self.rosters))}")
        
        # Team roster counts
        print(f"\n📋 Players per team:")
        for team_name, count in sorted(self.team_counts.items()):
            status = "✅" if count == 21 else "⚠️"
            print(f"   {status} {team_name}: {count} players")
        
        # Position distribution
        print(f"\n🏈 Position distribution:")
        total_expected = {'QB': 'varies', 'RB': 'varies', 'RC': 'varies', 'PK': '10-20', 'DU': '20'}
        for position, count in sorted(self.position_counts.items()):
            expected = total_expected.get(position, 'unknown')
            print(f"   {position}: {count} players (expected: {expected})")
        
        # Keeper vs Non-keeper
        keeper_count = sum(1 for r in self.rosters if r['is_keeper'])
        print(f"\n🔒 Keepers: {keeper_count}")
        print(f"🆕 Non-keepers: {len(self.rosters) - keeper_count}")
        
        # Acquisition types
        acq_types = Counter(r['acquisition_type'] for r in self.rosters)
        print(f"\n📈 Acquisition types:")
        for acq_type, count in acq_types.items():
            print(f"   {acq_type}: {count}")

    def clear_existing_data(self, confirm=True):
        """Clear existing fantasy_team_players data"""
        if confirm:
            response = input(f"\n⚠️  This will DELETE all existing player assignments. Continue? (yes/no): ").strip().lower()
            if response != 'yes':
                print("❌ Import cancelled by user")
                return False
        
        cursor = self.connection.cursor()
        try:
            cursor.execute("DELETE FROM fantasy_team_players")
            deleted_count = cursor.rowcount
            print(f"🗑️  Deleted {deleted_count} existing player assignments")
            return True
        except mysql.connector.Error as err:
            print(f"❌ Failed to clear existing data: {err}")
            return False
        finally:
            cursor.close()

    def import_rosters(self, dry_run=False):
        """Import roster data to database"""
        if dry_run:
            print(f"\n🔍 DRY RUN - Would import {len(self.rosters)} roster entries")
            return True
        
        print(f"\n💾 Importing {len(self.rosters)} roster entries...")
        
        cursor = self.connection.cursor()
        
        insert_query = """
        INSERT INTO fantasy_team_players 
        (fantasy_team_id, player_id, acquisition_type, is_keeper, acquisition_date)
        VALUES (%s, %s, %s, %s, NOW())
        """
        
        try:
            successful_imports = 0
            for roster in self.rosters:
                try:
                    cursor.execute(insert_query, (
                        roster['team_name_id'],      # fantasy_team_id
                        roster['player_name_id'],    # player_id
                        roster['acquisition_type'],  # acquisition_type
                        roster['is_keeper']          # is_keeper
                    ))
                    successful_imports += 1
                    
                except mysql.connector.Error as err:
                    self.errors.append(f"Import error for player {roster['player_name_id']}: {err}")
                    continue
            
            if not self.errors:
                self.connection.commit()
                print(f"✅ Successfully imported {successful_imports} roster entries!")
                self.stats['imported'] = successful_imports
            else:
                self.connection.rollback()
                print(f"❌ Import failed with {len(self.errors)} errors")
                for error in self.errors[:5]:
                    print(f"   {error}")
                return False
                
        except Exception as e:
            self.connection.rollback()
            print(f"❌ Import failed: {str(e)}")
            return False
        finally:
            cursor.close()
        
        return True

    def verify_import(self):
        """Verify the import was successful"""
        print(f"\n🔍 Verifying import...")
        
        cursor = self.connection.cursor()
        
        # Count total imported
        cursor.execute("SELECT COUNT(*) FROM fantasy_team_players")
        total_count = cursor.fetchone()[0]
        
        # Count by team
        cursor.execute("""
            SELECT ft.team_name, COUNT(*) as player_count
            FROM fantasy_team_players ftp
            JOIN fantasy_teams ft ON ftp.fantasy_team_id = ft.team_id
            GROUP BY ft.team_id, ft.team_name
            ORDER BY ft.team_id
        """)
        team_results = cursor.fetchall()
        
        # Count by position
        cursor.execute("""
            SELECT p.position, COUNT(*) as count
            FROM fantasy_team_players ftp
            JOIN nfl_players p ON ftp.player_id = p.player_id
            GROUP BY p.position
            ORDER BY count DESC
        """)
        position_results = cursor.fetchall()
        
        cursor.close()
        
        print(f"✅ Total players in database: {total_count}")
        print(f"\n📋 Players per team (should all be 21):")
        all_teams_correct = True
        for team_name, count in team_results:
            status = "✅" if count == 21 else "❌"
            if count != 21:
                all_teams_correct = False
            print(f"   {status} {team_name}: {count} players")
        
        print(f"\n🏈 Players by position:")
        for position, count in position_results:
            print(f"   {position}: {count}")
        
        if all_teams_correct and total_count == 210:
            print(f"\n🎉 Import verification PASSED!")
        else:
            print(f"\n⚠️  Import verification found issues!")
        
        return all_teams_correct and total_count == 210

def main():
    """Main execution function"""
    print("🏈 GBRFL Roster Import Script")
    print("=" * 50)
    
    importer = RosterImporter()
    
    # Validate file exists
    if not importer.validate_file():
        return
    
    # Connect to database
    if not importer.connect_to_database():
        return
    
    try:
        # Load and validate roster data
        if not importer.load_rosters():
            print("❌ Failed to load rosters. Fix validation errors and try again.")
            return
        
        # Validate database references
        if not importer.validate_database_references():
            print("❌ Database validation failed. Check missing IDs.")
            return
        
        # Print summary
        importer.print_summary()
        
        # Confirm import
        print(f"\n" + "="*50)
        response = input("Proceed with import? (y/N): ").strip().lower()
        if response != 'y':
            print("❌ Import cancelled by user")
            return
        
        # Clear existing data
        if not importer.clear_existing_data():
            return
        
        # Import data
        if importer.import_rosters(dry_run=False):
            # Verify import
            importer.verify_import()
            print(f"\n🎉 Roster import completed successfully!")
        else:
            print(f"\n❌ Roster import failed!")
            
    finally:
        importer.connection.close()
        print(f"\n🔌 Database connection closed")

if __name__ == "__main__":
    main()