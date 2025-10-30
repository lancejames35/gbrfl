-- Create table to store players that teams have selected to drop during trades
CREATE TABLE IF NOT EXISTS trade_drop_players (
  id INT PRIMARY KEY AUTO_INCREMENT,
  trade_id INT NOT NULL,
  team_id INT NOT NULL,
  player_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES trades(trade_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES fantasy_teams(team_id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES nfl_players(player_id) ON DELETE CASCADE,
  UNIQUE KEY unique_trade_team_player (trade_id, team_id, player_id)
);