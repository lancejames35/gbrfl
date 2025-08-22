#!/usr/bin/env python3
"""
NFL Player Stats Import Script
Imports player statistics directly from nflverse data into MySQL database
Cloud-ready with environment variable support
Includes sophisticated fumble attribution logic
"""

import os
import sys
import pandas as pd
import mysql.connector
from datetime import datetime
import nfl_data_py as nfl
from dotenv import load_dotenv

# Load environment variables from .env file (optional)
try:
    load_dotenv()
except:
    pass  # Continue without .env file

# Cloud-ready configuration
def get_db_config():
    """Get database configuration from environment variables or manual input"""
    print("Database Configuration:")
    config = {
        'host': os.getenv('DB_HOST') or input("MySQL host (default: localhost): ") or 'localhost',
        'port': int(os.getenv('DB_PORT') or input("MySQL port (default: 3306): ") or 3306),
        'database': os.getenv('DB_NAME') or input("Database name: "),
        'user': os.getenv('DB_USER') or input("MySQL username (default: root): ") or 'root',
        'password': os.getenv('DB_PASSWORD') or input("MySQL password: ")
    }
    return config

def connect_to_database(config):
    """Connect to MySQL database"""
    try:
        connection = mysql.connector.connect(
            host=config['host'],
            port=config['port'],
            database=config['database'],
            user=config['user'],
            password=config['password'],
            autocommit=True
        )
        print("✓ Database connection successful")
        return connection
    except mysql.connector.Error as err:
        print(f"✗ Database connection failed: {err}")
        return None

def load_nfl_data(seasons):
    """Load NFL data from nfl_data_py"""
    print(f"Loading NFL data for seasons: {min(seasons)}-{max(seasons)}")
    print("This may take several minutes for historical data...")
    
    try:
        # Load player stats (includes postseason by default)
        print("Loading player statistics...")
        player_stats = nfl.import_weekly_data(seasons)
        print(f"✓ Loaded {len(player_stats):,} player stat records")
        
        # Load schedule for game dates and opponents
        print("Loading schedule data...")
        schedule = nfl.import_schedules(seasons)
        print(f"✓ Loaded {len(schedule):,} schedule records")
        
        # Load play-by-play data for sophisticated fumble logic
        print("Loading play-by-play data for fumble attribution...")
        pbp_data = nfl.import_pbp_data(seasons)
        print(f"✓ Loaded {len(pbp_data):,} play-by-play records")
        
        # Filter for both regular season and postseason
        print("✓ Data includes both regular season and postseason games")
        
        return player_stats, schedule, pbp_data
        
    except ImportError as e:
        print(f"✗ Import error: {e}")
        print("Make sure nfl-data-py is properly installed: pip install --upgrade nfl-data-py")
        return None, None, None
    except ValueError as e:
        print(f"✗ Data error: {e}")
        print("This might be due to incomplete 2024 data or season range issues")
        return None, None, None
    except ConnectionError as e:
        print(f"✗ Connection error: {e}")
        print("Check your internet connection - data is downloaded from nflverse")
        return None, None, None
    except Exception as e:
        print(f"✗ Unexpected error loading NFL data: {e}")
        print(f"Error type: {type(e).__name__}")
        print("Tip: Try reducing the season range or check nfl-data-py documentation")
        print("For 2024 data issues, try excluding 2024: seasons 1999-2023")
        return None, None, None

def calculate_fumble_lost_attribution(play, player_id, team, fumbler_number):
    """
    Calculate individual fumble lost attribution using sophisticated logic
    """
    desc = str(play.get('desc', '')).lower()
    
    if fumbler_number == 1:
        # Logic for fumbled_1_player_id
        
        # If no recovery info, use play-level fumble_lost
        if pd.isna(play.get('fumble_recovery_1_team')):
            return int(play.get('fumble_lost', 0))
        
        # Complex lateral play detection
        if (('lateral' in desc) and 
            pd.notna(play.get('fumbled_2_player_id')) and
            play.get('fumble_recovery_1_team') == team and
            play.get('fumble_recovery_2_team') == team and
            play.get('fumble_lost') == 1):
            return int(play.get('fumble_lost', 0))
        
        # Same-player double fumble detection
        if (('fumbles' in desc and 'recovers' in desc and 'fumbles' in desc) or
            ('fumbles (aborted)' in desc and 'recovers' in desc and 'fumbles' in desc)) and pd.isna(play.get('fumbled_2_player_id')):
            final_recovery_team = play.get('fumble_recovery_2_team') or play.get('fumble_recovery_1_team')
            return 0 if final_recovery_team == team else 1
        
        # Multi-player fumble individual attribution
        if pd.notna(play.get('fumbled_2_player_id')):
            return 0 if play.get('fumble_recovery_1_team') == team else 1
        
        # Single player with second recovery
        if pd.notna(play.get('fumble_recovery_2_team')):
            return 0 if play.get('fumble_recovery_2_team') == team else 1
        
        # Standard case - use first recovery
        return 0 if play.get('fumble_recovery_1_team') == team else 1
    
    else:  # fumbler_number == 2
        # Logic for fumbled_2_player_id
        
        # Complex lateral play detection
        if (('lateral' in desc) and
            play.get('fumble_recovery_1_team') == team and
            play.get('fumble_recovery_2_team') == team and
            play.get('fumble_lost') == 1):
            return int(play.get('fumble_lost', 0))
        
        # Special touchback case for recoverer who fumbles
        if (pd.isna(play.get('fumble_recovery_2_team')) and
            player_id == play.get('fumble_recovery_1_player_id') and
            play.get('fumbled_1_player_id') != play.get('fumbled_2_player_id')):
            return 1 if 'touchback' in desc else 0
        
        # If no second recovery, use play-level fumble_lost
        if pd.isna(play.get('fumble_recovery_2_team')):
            return int(play.get('fumble_lost', 0))
        
        # Use second recovery for attribution
        return 0 if play.get('fumble_recovery_2_team') == team else 1

def calculate_sophisticated_fumbles(pbp_data, player_stats):
    """
    Calculate fumbles lost using sophisticated attribution logic
    Recreates the complex fumble logic from your MySQL queries
    """
    print("Calculating sophisticated fumble attribution...")
    
    # Filter for fumble plays
    fumble_plays = pbp_data[
        (pbp_data['fumble'] == 1)
    ].copy()
    
    print(f"Processing {len(fumble_plays):,} fumble plays...")
    
    # Helper function to determine team assignment
    def get_player_team(row, player_id, player_stats_lookup):
        """Determine team assignment for a player using sophisticated logic"""
        if pd.isna(player_id):
            return None
            
        # Special teams scenarios
        if player_id == row.get('punt_returner_player_id'):
            return row['defteam']
        elif player_id == row.get('kickoff_returner_player_id'):
            return row['posteam'] 
        elif player_id == row.get('interception_player_id'):
            return row['defteam']
        else:
            # Look up in player_stats for this season/week
            lookup_key = (player_id, row['season'], row['week'])
            if lookup_key in player_stats_lookup:
                return player_stats_lookup[lookup_key]
            else:
                return row['posteam']  # Fallback
    
    # Create player_stats lookup for team assignment
    player_stats_lookup = {}
    for _, row in player_stats.iterrows():
        if pd.notna(row.get('player_id')):
            key = (row['player_id'], row['season'], row['week'])
            player_stats_lookup[key] = row['recent_team']
    
    # Process each fumbler
    fumble_results = []
    
    for _, play in fumble_plays.iterrows():
        # Process fumbled_1_player_id
        if pd.notna(play.get('fumbled_1_player_id')):
            player_id = play['fumbled_1_player_id']
            team = get_player_team(play, player_id, player_stats_lookup)
            
            # Sophisticated fumble lost attribution for player 1
            fumble_lost = calculate_fumble_lost_attribution(play, player_id, team, fumbler_number=1)
            
            fumble_results.append({
                'player_id': player_id,
                'season': play['season'],
                'week': play['week'],
                'team': team,
                'fumbles_lost': fumble_lost
            })
        
        # Process fumbled_2_player_id
        if pd.notna(play.get('fumbled_2_player_id')):
            player_id = play['fumbled_2_player_id']
            
            # Special case: if fumbled_2_player_id == fumble_recovery_1_player_id
            if player_id == play.get('fumble_recovery_1_player_id'):
                team = play.get('fumble_recovery_1_team')
            else:
                team = get_player_team(play, player_id, player_stats_lookup)
            
            # Sophisticated fumble lost attribution for player 2
            fumble_lost = calculate_fumble_lost_attribution(play, player_id, team, fumbler_number=2)
            
            fumble_results.append({
                'player_id': player_id,
                'season': play['season'],
                'week': play['week'],
                'team': team,
                'fumbles_lost': fumble_lost
            })
    
    # Convert to DataFrame and aggregate
    fumble_df = pd.DataFrame(fumble_results)
    if len(fumble_df) > 0:
        fumble_summary = fumble_df.groupby(['player_id', 'season', 'week', 'team']).agg({
            'fumbles_lost': 'sum'
        }).reset_index()
    else:
        fumble_summary = pd.DataFrame(columns=['player_id', 'season', 'week', 'team', 'fumbles_lost'])
    
    print(f"✓ Processed sophisticated fumble attribution for {len(fumble_summary):,} player-game records")
    return fumble_summary

def process_data(player_stats, schedule, pbp_data):
    """Process and clean the NFL data"""
    print("Processing and cleaning data...")
    
    # Calculate sophisticated fumble attribution
    fumble_data = calculate_sophisticated_fumbles(pbp_data, player_stats)
    
    # Prepare schedule lookup
    schedule_lookup = schedule[['game_id', 'season', 'week', 'gameday', 
                               'home_team', 'away_team', 'game_type']].copy()
    
    # Join player stats with schedule
    merged_data = player_stats.merge(
        schedule_lookup, 
        on=['season', 'week'], 
        how='left'
    )
    
    # Determine opponent
    merged_data['opponent'] = merged_data.apply(
        lambda row: row['away_team'] if row['recent_team'] == row['home_team'] else row['home_team'], 
        axis=1
    )
    
    # Merge with sophisticated fumble data
    if len(fumble_data) > 0:
        merged_data = merged_data.merge(
            fumble_data,
            left_on=['player_id', 'season', 'week', 'recent_team'],
            right_on=['player_id', 'season', 'week', 'team'],
            how='left',
            suffixes=('', '_sophisticated')
        )
        # Use sophisticated fumbles_lost where available, otherwise use standard
        merged_data['fumbles_lost_final'] = merged_data['fumbles_lost_sophisticated'].fillna(
            merged_data['rushing_fumbles_lost'].fillna(0) + 
            merged_data['receiving_fumbles_lost'].fillna(0) + 
            merged_data['sack_fumbles_lost'].fillna(0)
        )
    else:
        # Fallback to standard fumble calculation
        merged_data['fumbles_lost_final'] = (
            merged_data['rushing_fumbles_lost'].fillna(0) + 
            merged_data['receiving_fumbles_lost'].fillna(0) + 
            merged_data['sack_fumbles_lost'].fillna(0)
        )
    
    # Select and rename columns for our table
    processed_data = merged_data[[
        'player_display_name', 'season', 'week', 'game_type', 'gameday', 
        'recent_team', 'opponent',
        'completions', 'attempts', 'passing_yards', 'passing_tds', 'interceptions',
        'carries', 'rushing_yards', 'rushing_tds',
        'receptions', 'receiving_yards', 'receiving_tds',
        'fumbles_lost_final',
        'passing_2pt_conversions', 'rushing_2pt_conversions', 'receiving_2pt_conversions',
        'fg_made_0_19', 'fg_made_20_29', 'fg_made_30_39', 'fg_made_40_49', 
        'fg_made_50_59', 'fg_made_60_', 'pat_made'
    ]].copy()
    
    # Fill NaN values with 0
    numeric_columns = [
        'completions', 'attempts', 'passing_yards', 'passing_tds', 'interceptions',
        'carries', 'rushing_yards', 'rushing_tds',
        'receptions', 'receiving_yards', 'receiving_tds',
        'fumbles_lost_final',
        'passing_2pt_conversions', 'rushing_2pt_conversions', 'receiving_2pt_conversions',
        'fg_made_0_19', 'fg_made_20_29', 'fg_made_30_39', 'fg_made_40_49', 
        'fg_made_50_59', 'fg_made_60_', 'pat_made'
    ]
    
    for col in numeric_columns:
        processed_data[col] = processed_data[col].fillna(0).astype(int)
    
    # Create calculated fields
    processed_data['two_point_conversions'] = (
        processed_data['passing_2pt_conversions'] + 
        processed_data['rushing_2pt_conversions'] + 
        processed_data['receiving_2pt_conversions']
    )
    
    # Aggregate field goals by range
    processed_data['fg_under_30'] = processed_data['fg_made_0_19'] + processed_data['fg_made_20_29']
    processed_data['fg_30_39'] = processed_data['fg_made_30_39']
    processed_data['fg_40_49'] = processed_data['fg_made_40_49']
    processed_data['fg_50_plus'] = processed_data['fg_made_50_59'] + processed_data['fg_made_60_']
    
    # Rename columns to match our table schema
    final_data = processed_data.rename(columns={
        'player_display_name': 'player_name',
        'gameday': 'game_date',
        'recent_team': 'team',
        'completions': 'pass_completions',
        'attempts': 'pass_attempts',
        'passing_yards': 'pass_yards',
        'passing_tds': 'pass_touchdowns',
        'carries': 'rush_attempts',
        'rushing_yards': 'rush_yards',
        'rushing_tds': 'rush_touchdowns',
        'receiving_yards': 'receiving_yards',
        'receiving_tds': 'receiving_touchdowns',
        'fumbles_lost_final': 'fumbles_lost',
        'pat_made': 'extra_points_made'
    })
    
    # Select final columns for our table
    final_columns = [
        'player_name', 'season', 'week', 'game_type', 'game_date', 'team', 'opponent',
        'pass_completions', 'pass_attempts', 'pass_yards', 'pass_touchdowns', 'interceptions',
        'rush_attempts', 'rush_yards', 'rush_touchdowns',
        'receptions', 'receiving_yards', 'receiving_touchdowns',
        'fumbles_lost', 'two_point_conversions',
        'fg_under_30', 'fg_30_39', 'fg_40_49', 'fg_50_plus', 'extra_points_made'
    ]
    
    final_data = final_data[final_columns]
    
    # Filter for players with meaningful stats
    meaningful_stats = (
        (final_data['pass_completions'] > 0) | (final_data['pass_attempts'] > 0) |
        (final_data['pass_yards'] > 0) | (final_data['pass_touchdowns'] > 0) |
        (final_data['interceptions'] > 0) | (final_data['rush_attempts'] > 0) |
        (final_data['rush_yards'] > 0) | (final_data['rush_touchdowns'] > 0) |
        (final_data['receptions'] > 0) | (final_data['receiving_yards'] > 0) |
        (final_data['receiving_touchdowns'] > 0) | (final_data['fumbles_lost'] > 0) |
        (final_data['two_point_conversions'] > 0) | (final_data['fg_under_30'] > 0) |
        (final_data['fg_30_39'] > 0) | (final_data['fg_40_49'] > 0) |
        (final_data['fg_50_plus'] > 0) | (final_data['extra_points_made'] > 0)
    )
    
    final_data = final_data[meaningful_stats].copy()
    
    # Remove any remaining NaN values and sort
    final_data = final_data.dropna(subset=['player_name', 'game_date'])
    final_data = final_data.sort_values(['season', 'week', 'player_name'])
    
    print(f"✓ Processed {len(final_data):,} records")
    print(f"✓ Season range: {final_data['season'].min()}-{final_data['season'].max()}")
    print(f"✓ Unique players: {final_data['player_name'].nunique():,}")
    
    return final_data

def import_to_database(connection, data):
    """Import data to MySQL database in batches"""
    print(f"Importing {len(data):,} records to database...")
    
    cursor = connection.cursor()
    batch_size = 2000  # Larger batches for full historical import
    successful_imports = 0
    
    # Prepare INSERT statement
    insert_query = """
        INSERT INTO player_stats (
            player_name, season, week, game_type, game_date, team, opponent,
            pass_completions, pass_attempts, pass_yards, pass_touchdowns, interceptions,
            rush_attempts, rush_yards, rush_touchdowns,
            receptions, receiving_yards, receiving_touchdowns,
            fumbles_lost, two_point_conversions,
            fg_under_30, fg_30_39, fg_40_49, fg_50_plus, extra_points_made
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            pass_completions = VALUES(pass_completions),
            pass_attempts = VALUES(pass_attempts),
            pass_yards = VALUES(pass_yards),
            pass_touchdowns = VALUES(pass_touchdowns),
            interceptions = VALUES(interceptions),
            rush_attempts = VALUES(rush_attempts),
            rush_yards = VALUES(rush_yards),
            rush_touchdowns = VALUES(rush_touchdowns),
            receptions = VALUES(receptions),
            receiving_yards = VALUES(receiving_yards),
            receiving_touchdowns = VALUES(receiving_touchdowns),
            fumbles_lost = VALUES(fumbles_lost),
            two_point_conversions = VALUES(two_point_conversions),
            fg_under_30 = VALUES(fg_under_30),
            fg_30_39 = VALUES(fg_30_39),
            fg_40_49 = VALUES(fg_40_49),
            fg_50_plus = VALUES(fg_50_plus),
            extra_points_made = VALUES(extra_points_made)
    """
    
    # Process in batches with progress updates
    total_batches = (len(data) + batch_size - 1) // batch_size
    print(f"Processing {total_batches:,} batches of {batch_size:,} records each...")
    
    for i in range(0, len(data), batch_size):
        batch = data.iloc[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        
        # Convert batch to list of tuples
        batch_values = []
        for _, row in batch.iterrows():
            batch_values.append(tuple(row))
        
        try:
            cursor.executemany(insert_query, batch_values)
            successful_imports += len(batch_values)
            
            # Progress update every 5 batches for historical import
            if batch_num % 5 == 0 or batch_num == total_batches:
                percent_complete = (successful_imports / len(data)) * 100
                print(f"Batch {batch_num:,}/{total_batches:,} - {successful_imports:,}/{len(data):,} records ({percent_complete:.1f}%)")
                
        except mysql.connector.Error as err:
            print(f"✗ Error in batch {batch_num} (starting at row {i}): {err}")
    
    cursor.close()
    print(f"✅ Successfully imported {successful_imports:,} records!")
    return successful_imports == len(data)

def generate_summary(connection):
    """Generate summary statistics"""
    print("\n=== IMPORT VERIFICATION ===")
    
    cursor = connection.cursor()
    
    # Total count
    cursor.execute("SELECT COUNT(*) FROM player_stats")
    total_count = cursor.fetchone()[0]
    print(f"Total records: {total_count:,}")
    
    # Game type breakdown
    cursor.execute("""
        SELECT game_type, COUNT(*) as records, COUNT(DISTINCT player_name) as players
        FROM player_stats 
        GROUP BY game_type 
        ORDER BY game_type
    """)
    
    print("\nGame type breakdown:")
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,} records, {row[2]:,} players")
    
    # Season range
    cursor.execute("""
        SELECT MIN(season) as min_season, MAX(season) as max_season,
               SUM(fumbles_lost) as total_fumbles_lost,
               SUM(two_point_conversions) as total_2pt,
               COUNT(DISTINCT player_name) as unique_players
        FROM player_stats
    """)
    
    result = cursor.fetchone()
    print(f"\nSeason range: {result[0]}-{result[1]}")
    print(f"Unique players: {result[4]:,}")
    print(f"Total fumbles lost: {result[2]:,} (using sophisticated attribution)")
    print(f"Total 2PT conversions: {result[3]:,}")
    
    cursor.close()

def main():
    """Main execution function"""
    print("NFL Player Stats Import Script (Python)")
    print("Source: nfl_data_py")
    print("Target: player_stats table")
    print("Full Historical Import: 1999-2024 (26 seasons)\n")
    
    # Full historical range (1999-2024) - your complete dataset
    start_season = int(os.getenv('START_SEASON', input("Enter start season (default: 1999): ") or 1999))
    end_season = int(os.getenv('END_SEASON', input("Enter end season (default: 2024): ") or 2024))
    seasons = list(range(start_season, end_season + 1))
    
    print(f"\nProcessing seasons: {min(seasons)}-{max(seasons)} ({len(seasons)} seasons)")
    print("Note: Includes both regular season and playoffs")
    print("⚠️  FULL HISTORICAL IMPORT - This will take 15-30 minutes and process 1M+ records")
    
    # Skip confirmation if running automated
    if not os.getenv('AUTOMATED_RUN'):
        proceed = input("\nContinue? (y/n): ").lower()
        if proceed != 'y':
            print("Import cancelled.")
            return
    else:
        print("Running in automated mode...")
    
    # Database connection
    db_config = get_db_config()
    connection = connect_to_database(db_config)
    if not connection:
        sys.exit(1)
    
    try:
        # Load data
        player_stats, schedule, pbp_data = load_nfl_data(seasons)
        if player_stats is None or schedule is None or pbp_data is None:
            sys.exit(1)
        
        # Process data with sophisticated fumble logic
        processed_data = process_data(player_stats, schedule, pbp_data)
        
        # Import to database
        success = import_to_database(connection, processed_data)
        
        if success:
            generate_summary(connection)
            print("\n🏆 IMPORT SUCCESSFUL! 🏆")
            print("Your player_stats table is now populated with NFL data.")
            print("✓ Includes sophisticated fumble attribution logic!")
        
    except Exception as e:
        print(f"✗ Import failed: {e}")
        raise  # Re-raise for cloud monitoring
    finally:
        connection.close()

if __name__ == "__main__":
    main()