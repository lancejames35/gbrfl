-- Create historical tables in local database
-- Run this against your local gbrfl database

-- Historical Keepers Table
CREATE TABLE IF NOT EXISTS `historical_keepers` (
  `keeper_id` int NOT NULL AUTO_INCREMENT,
  `season_year` int NOT NULL,
  `fantasy_team_id` int NOT NULL,
  `player_id` int NOT NULL,
  `espn_id` varchar(20) DEFAULT NULL,
  `designation_date` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`keeper_id`),
  KEY `idx_season_team` (`season_year`,`fantasy_team_id`),
  KEY `idx_player` (`player_id`),
  KEY `idx_espn` (`espn_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Historical Rosters Table
CREATE TABLE IF NOT EXISTS `historical_rosters` (
  `roster_id` int NOT NULL AUTO_INCREMENT,
  `season_year` int NOT NULL,
  `fantasy_team_id` int NOT NULL,
  `player_id` int NOT NULL,
  `espn_id` varchar(20) DEFAULT NULL,
  `active_from` datetime NOT NULL,
  `active_until` datetime DEFAULT NULL,
  `acquisition_type` enum('Draft','Free Agent','Trade','Keeper','Waiver') DEFAULT NULL,
  `acquisition_date` datetime DEFAULT NULL,
  `was_keeper` tinyint(1) DEFAULT '0',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`roster_id`),
  KEY `idx_season_team` (`season_year`,`fantasy_team_id`),
  KEY `idx_player` (`player_id`),
  KEY `idx_active_period` (`active_from`,`active_until`),
  KEY `idx_espn` (`espn_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Historical Lineups Table
CREATE TABLE IF NOT EXISTS `historical_lineups` (
  `historical_lineup_id` int NOT NULL AUTO_INCREMENT,
  `season_year` int NOT NULL,
  `week_number` int NOT NULL,
  `game_type` enum('primary','bonus') NOT NULL DEFAULT 'primary',
  `fantasy_team_id` int NOT NULL,
  `team_name_at_time` varchar(100) DEFAULT NULL,
  `owner_name_at_time` varchar(100) DEFAULT NULL,
  `player_id` int NOT NULL,
  `espn_id` varchar(20) DEFAULT NULL,
  `player_name_at_time` varchar(100) DEFAULT NULL,
  `position` varchar(10) NOT NULL,
  `lineup_position` varchar(20) DEFAULT NULL,
  `acquisition_type` enum('Draft','Free Agent','Trade','Keeper','Waiver','Unknown') DEFAULT 'Unknown',
  `was_keeper` tinyint(1) DEFAULT '0',
  `submitted_at` datetime DEFAULT NULL,
  `is_locked` tinyint(1) DEFAULT '0',
  `lineup_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`historical_lineup_id`),
  KEY `idx_season_week` (`season_year`,`week_number`,`game_type`),
  KEY `idx_team` (`fantasy_team_id`),
  KEY `idx_player` (`player_id`),
  KEY `idx_lineup` (`lineup_id`),
  KEY `idx_espn` (`espn_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Historical Team Names Table
CREATE TABLE IF NOT EXISTS `historical_team_names` (
  `name_history_id` int NOT NULL AUTO_INCREMENT,
  `fantasy_team_id` int NOT NULL,
  `team_name` varchar(100) NOT NULL,
  `active_from` datetime NOT NULL,
  `active_until` datetime DEFAULT NULL,
  `changed_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`name_history_id`),
  KEY `idx_team` (`fantasy_team_id`),
  KEY `idx_active_period` (`active_from`,`active_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
