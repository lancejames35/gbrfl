-- ============================================================================
-- Historical Rosters Backfill Script
-- Generated: 2025-10-29
-- Purpose: Populate historical_rosters with complete temporal roster tracking
-- ============================================================================

-- Step 1: Insert all current roster players (keepers and drafted)
-- These are players currently on rosters with active_until = NULL

INSERT INTO historical_rosters
  (season_year, fantasy_team_id, player_id, espn_id,
   active_from, active_until, acquisition_type, acquisition_date,
   was_keeper, notes)
SELECT
  2025 as season_year,
  ftp.fantasy_team_id,
  ftp.player_id,
  np.espn_id,
  ftp.acquisition_date as active_from,
  NULL as active_until,  -- Still on roster
  ftp.acquisition_type,
  ftp.acquisition_date,
  ftp.is_keeper as was_keeper,
  'Current roster player' as notes
FROM fantasy_team_players ftp
JOIN nfl_players np ON ftp.player_id = np.player_id
WHERE ftp.fantasy_team_id IS NOT NULL;

-- Verification: Check current roster entries
SELECT
  'Current Roster Players' as category,
  COUNT(*) as count,
  COUNT(DISTINCT fantasy_team_id) as teams
FROM historical_rosters
WHERE season_year = 2025 AND active_until IS NULL;

-- ============================================================================
-- Step 2: Handle traded players
-- For each trade, we need to create:
--   1. An "ending" entry for the old team (active_until = trade date)
--   2. A "starting" entry for the new team (active_from = trade date)
-- ============================================================================

-- First, let's document the trades that have occurred
-- This will help us understand which players need historical entries

-- View all trades
SELECT
  t.trade_id,
  t.status,
  t.proposal_date,
  t.completion_date,
  ti_from.team_id as from_team,
  ti_to.team_id as to_team,
  ti_from.player_id,
  np.display_name as player_name
FROM trades t
JOIN trade_items ti_from ON t.trade_id = ti_from.trade_id AND ti_from.item_type = 'Player' AND ti_from.direction = 'from'
JOIN trade_items ti_to ON t.trade_id = ti_to.trade_id AND ti_to.player_id = ti_from.player_id AND ti_to.direction = 'to'
JOIN nfl_players np ON ti_from.player_id = np.player_id
WHERE t.status IN ('Accepted', 'Completed');

-- ============================================================================
-- Note: Manual trade entries need to be added here
-- We cannot automatically generate these without more trade metadata
-- The query above shows all trades that have occurred
--
-- For each traded player, you would add:
--
-- INSERT INTO historical_rosters
-- (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
--  acquisition_type, acquisition_date, was_keeper, traded_to_team_id, related_trade_id, notes)
-- VALUES
-- (2025, OLD_TEAM_ID, PLAYER_ID, ESPN_ID, ORIGINAL_ACQ_DATE, TRADE_DATE,
--  'Keeper', ORIGINAL_ACQ_DATE, 1, NEW_TEAM_ID, TRADE_ID, 'Traded away');
--
-- INSERT INTO historical_rosters
-- (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
--  acquisition_type, acquisition_date, was_keeper, acquired_from_team_id, related_trade_id, notes)
-- VALUES
-- (2025, NEW_TEAM_ID, PLAYER_ID, ESPN_ID, TRADE_DATE, NULL,
--  'Trade', TRADE_DATE, 0, OLD_TEAM_ID, TRADE_ID, 'Acquired via trade');
-- ============================================================================

-- ============================================================================
-- Step 3: Summary and Verification
-- ============================================================================

-- Show historical rosters summary by team
SELECT
  ft.team_name,
  COUNT(*) as total_entries,
  SUM(CASE WHEN hr.active_until IS NULL THEN 1 ELSE 0 END) as current_players,
  SUM(CASE WHEN hr.active_until IS NOT NULL THEN 1 ELSE 0 END) as past_players,
  SUM(CASE WHEN hr.was_keeper = 1 THEN 1 ELSE 0 END) as keepers,
  SUM(CASE WHEN hr.acquisition_type = 'Draft' THEN 1 ELSE 0 END) as drafted,
  SUM(CASE WHEN hr.acquisition_type = 'Trade' THEN 1 ELSE 0 END) as trades
FROM historical_rosters hr
JOIN fantasy_teams ft ON hr.fantasy_team_id = ft.team_id
WHERE hr.season_year = 2025
GROUP BY ft.team_name
ORDER BY ft.team_id;

-- Show total counts
SELECT
  'Total Roster Entries' as metric,
  COUNT(*) as value
FROM historical_rosters
WHERE season_year = 2025
UNION ALL
SELECT
  'Unique Players',
  COUNT(DISTINCT player_id)
FROM historical_rosters
WHERE season_year = 2025
UNION ALL
SELECT
  'Active (Current) Entries',
  COUNT(*)
FROM historical_rosters
WHERE season_year = 2025 AND active_until IS NULL
UNION ALL
SELECT
  'Historical (Past) Entries',
  COUNT(*)
FROM historical_rosters
WHERE season_year = 2025 AND active_until IS NOT NULL;
