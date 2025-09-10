-- Production fix script
-- Run this on production database to fix missing tables and data

-- 1. Create nfl_games table if it doesn't exist
CREATE TABLE IF NOT EXISTS nfl_games (
  game_id INT AUTO_INCREMENT PRIMARY KEY,
  week_number INT NOT NULL,
  season_year INT NOT NULL,
  home_team VARCHAR(50) NOT NULL,
  away_team VARCHAR(50) NOT NULL,
  kickoff_time DATETIME NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_week_season (week_number, season_year),
  INDEX idx_kickoff (kickoff_time)
);

-- 2. Create league_standings table if it doesn't exist
CREATE TABLE IF NOT EXISTS league_standings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fantasy_team_id INT NOT NULL,
  season_year INT NOT NULL,
  position INT DEFAULT NULL,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  points_differential INT DEFAULT 0,
  games_behind INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_season (fantasy_team_id, season_year),
  FOREIGN KEY (fantasy_team_id) REFERENCES fantasy_teams(team_id) ON DELETE CASCADE
);

-- 3. Add waiver_round column to waiver_requests if it doesn't exist
ALTER TABLE waiver_requests ADD COLUMN IF NOT EXISTS waiver_round INT DEFAULT 1;

-- 4. Populate league_standings with initial data if empty
INSERT IGNORE INTO league_standings (fantasy_team_id, season_year, position, wins, losses, points_differential, games_behind) 
SELECT 
  team_id, 
  2025, 
  ROW_NUMBER() OVER (ORDER BY team_id), 
  0, 
  0, 
  0, 
  0
FROM fantasy_teams 
WHERE team_id NOT IN (SELECT fantasy_team_id FROM league_standings WHERE season_year = 2025);

-- 5. Sample NFL games data for week 1 (minimum needed for system to work)
INSERT IGNORE INTO nfl_games (week_number, season_year, home_team, away_team, kickoff_time, is_completed) VALUES
(1, 2025, 'KC', 'BAL', '2025-09-05 20:20:00', true),
(1, 2025, 'ATL', 'PIT', '2025-09-08 13:00:00', true),
(1, 2025, 'ARI', 'BUF', '2025-09-08 13:00:00', true),
(1, 2025, 'CIN', 'NE', '2025-09-08 13:00:00', true),
(1, 2025, 'HOU', 'IND', '2025-09-08 13:00:00', true),
(1, 2025, 'JAX', 'MIA', '2025-09-08 13:00:00', true),
(1, 2025, 'MIN', 'CHI', '2025-09-08 13:00:00', true),
(1, 2025, 'NO', 'CAR', '2025-09-08 13:00:00', true),
(1, 2025, 'PHI', 'GB', '2025-09-08 13:00:00', true),
(1, 2025, 'TB', 'WAS', '2025-09-08 13:00:00', true),
(1, 2025, 'TEN', 'NYJ', '2025-09-08 13:00:00', true),
(1, 2025, 'CLE', 'DAL', '2025-09-08 16:25:00', true),
(1, 2025, 'DEN', 'LV', '2025-09-08 16:25:00', true),
(1, 2025, 'LAC', 'LAR', '2025-09-08 16:25:00', true),
(1, 2025, 'SEA', 'SF', '2025-09-08 16:25:00', true),
(1, 2025, 'NYG', 'DET', '2025-09-08 20:20:00', true),
(2, 2025, 'BUF', 'MIA', '2025-09-12 20:15:00', false),
(2, 2025, 'CHI', 'HOU', '2025-09-15 13:00:00', false),
(2, 2025, 'NYJ', 'TEN', '2025-09-15 13:00:00', false),
(2, 2025, 'NE', 'SEA', '2025-09-15 13:00:00', false);