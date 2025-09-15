import mysql.connector
import csv
import sys
from datetime import datetime

def export_fantasy_rosters():
    """
    Export fantasy teams and their players to a CSV file
    """
    
    # Database connection parameters
    db_config = {
        'host': 'caboose.proxy.rlwy.net',
        'user': 'root',
        'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
        'database': 'railway',
        'port': 59613,
        'charset': 'utf8mb4'
    }
    
    # SQL query to get fantasy teams and their players with positions and ESPN IDs
    query = """
    SELECT 
        ft.team_id,
        ft.team_name,
        ft.head_coach,
        u.username as owner_username,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name,
        np.player_id,
        np.display_name as player_name,
        np.first_name,
        np.last_name,
        np.position,
        np.espn_id,
        nt.team_name as nfl_team,
        nt.team_code as nfl_team_code,
        ftp.acquisition_type,
        ftp.acquisition_date,
        ftp.is_keeper
    FROM fantasy_team_players ftp
    JOIN fantasy_teams ft ON ftp.fantasy_team_id = ft.team_id
    JOIN users u ON ft.user_id = u.user_id
    JOIN nfl_players np ON ftp.player_id = np.player_id
    LEFT JOIN nfl_teams nt ON np.nfl_team_id = nt.nfl_team_id
    ORDER BY ft.team_name, np.position, np.display_name
    """
    
    try:
        # Connect to database
        print("Connecting to database...")
        connection = mysql.connector.connect(**db_config)
        cursor = connection.cursor()
        
        # Execute query
        print("Executing query...")
        cursor.execute(query)
        results = cursor.fetchall()
        
        # Get column names
        column_names = [desc[0] for desc in cursor.description]
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"rosters_{timestamp}.csv"
        
        # Write to CSV
        print(f"Writing {len(results)} records to {filename}...")
        with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            
            # Write header
            writer.writerow(column_names)
            
            # Write data
            writer.writerows(results)
        
        print(f"Export completed successfully!")
        print(f"Rosters file saved as: {filename}")
        print(f"Total records exported: {len(results)}")
        
        # Print summary by team
        print("\nRoster summary by team:")
        team_counts = {}
        for row in results:
            team_name = row[1]  # team_name is at index 1
            team_counts[team_name] = team_counts.get(team_name, 0) + 1
        
        for team, count in sorted(team_counts.items()):
            print(f"  {team}: {count} players")
            
        return filename
    
    except mysql.connector.Error as e:
        print(f"Database error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        if 'connection' in locals() and connection.is_connected():
            cursor.close()
            connection.close()

def export_free_agents():
    """
    Export all available players not on any fantasy team to a CSV file
    """
    
    # Database connection parameters
    db_config = {
        'host': 'caboose.proxy.rlwy.net',
        'user': 'root',
        'password': 'JZjKXAUlauvUwThojErTNcsjYOIhOMDa',
        'database': 'railway',
        'port': 59613,
        'charset': 'utf8mb4'
    }
    
    # SQL query to get all NFL players not on any fantasy team
    query = """
    SELECT 
        np.player_id,
        np.display_name as player_name,
        np.first_name,
        np.last_name,
        np.position,
        np.espn_id,
        nt.team_name as nfl_team,
        nt.team_code as nfl_team_code,
        nt.conference,
        nt.division,
        ep.active as is_active,
        ep.injured as is_injured,
        ep.status as player_status,
        ep.jersey_number,
        ep.height,
        ep.weight,
        ep.age,
        ep.experience,
        ep.college
    FROM nfl_players np
    LEFT JOIN fantasy_team_players ftp ON np.player_id = ftp.player_id
    LEFT JOIN nfl_teams nt ON np.nfl_team_id = nt.nfl_team_id
    LEFT JOIN espn_players ep ON np.espn_id = ep.espn_id
    WHERE ftp.player_id IS NULL
    ORDER BY np.position, nt.team_code, np.display_name
    """
    
    try:
        # Connect to database
        print("\nConnecting to database for free agents export...")
        connection = mysql.connector.connect(**db_config)
        cursor = connection.cursor()
        
        # Execute query
        print("Executing free agents query...")
        cursor.execute(query)
        results = cursor.fetchall()
        
        # Get column names
        column_names = [desc[0] for desc in cursor.description]
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"free_agents_{timestamp}.csv"
        
        # Write to CSV
        print(f"Writing {len(results)} free agents to {filename}...")
        with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            
            # Write header
            writer.writerow(column_names)
            
            # Write data
            writer.writerows(results)
        
        print(f"Free agents export completed successfully!")
        print(f"Free agents file saved as: {filename}")
        print(f"Total free agents exported: {len(results)}")
        
        # Print summary by position
        print("\nFree agents summary by position:")
        position_counts = {}
        for row in results:
            position = row[4]  # position is at index 4
            position_counts[position] = position_counts.get(position, 0) + 1
        
        for position, count in sorted(position_counts.items()):
            print(f"  {position}: {count} players")
            
        return filename
    
    except mysql.connector.Error as e:
        print(f"Database error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        if 'connection' in locals() and connection.is_connected():
            cursor.close()
            connection.close()

def main():
    """
    Main function to export both rosters and free agents
    """
    print("Starting fantasy football data export...")
    print("=" * 50)
    
    # Export fantasy rosters
    rosters_file = export_fantasy_rosters()
    
    # Export free agents
    free_agents_file = export_free_agents()
    
    print("\n" + "=" * 50)
    print("All exports completed successfully!")
    print(f"Files created:")
    print(f"  - Rosters: {rosters_file}")
    print(f"  - Free Agents: {free_agents_file}")
    print("\nDatabase connections closed.")

if __name__ == "__main__":
    main()