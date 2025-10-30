# Historical Data Preservation - Handoff Document

**Date**: October 29, 2025
**Status**: Phase 1 Complete - Database Schema Created
**Next Phase**: Data Backfill & Application Updates

---

## Problem Statement

### Critical Issues Identified

1. **Lost Keeper Data**: The original 120 keeper designations from August 25, 2025 are not fully preserved. Only 105 keepers remain in the database due to trades and drops.

2. **Historical Lineups Show Gaps**: When viewing past week lineups, players who have been traded or dropped appear missing because `lineup_positions` references `fantasy_team_players` via `player_id`, but traded players have had their `fantasy_team_id` updated or records deleted.

3. **Root Cause**:
   - `fantasy_team_players` has UNIQUE constraint on `player_id` (only one team can own a player at a time)
   - When trades occur, the system UPDATES `fantasy_team_id` or DELETES the record, destroying history
   - `FantasyTeam.removePlayerFromRoster()` uses `DELETE FROM fantasy_team_players` (line 273 of models/FantasyTeam.js)

4. **Missing Historical Context**: No temporal tracking of:
   - When players joined/left teams
   - Original keeper designations before trades
   - Team name changes (e.g., Team 10: "Manstraighting to Seven" → "Rough Rodgers Goes Riding")

---

## What We've Completed

### ✅ Phase 1: Database Schema (NON-DESTRUCTIVE)

Created 4 new historical tables **WITHOUT modifying existing tables**:

#### 1. `historical_keepers`
- **Purpose**: Permanent snapshot of keeper designations at season start
- **Key Fields**: season_year, fantasy_team_id, player_id, espn_id, designation_date
- **Unique Constraint**: (season_year, fantasy_team_id, player_id)
- **Will Store**: The original 120 keeper designations from August 25, 2025

#### 2. `historical_rosters`
- **Purpose**: Complete temporal tracking of roster membership
- **Key Fields**:
  - `active_from` / `active_until` (temporal tracking)
  - `acquisition_type`, `was_keeper`
  - `acquired_from_team_id`, `traded_to_team_id`, `related_trade_id`
- **Will Store**: Every instance of a player being on a team with start/end dates

#### 3. `historical_lineups`
- **Purpose**: Snapshot of lineup submissions with ownership context
- **Key Fields**:
  - week_number, game_type, fantasy_team_id
  - player_id, espn_id, lineup_position
  - team_name_at_time, player_name_at_time
  - acquisition_type, was_keeper
- **Will Store**: All 8 weeks of lineups from CSV with complete context

#### 4. `historical_team_names`
- **Purpose**: Track team name changes over time
- **Key Fields**: fantasy_team_id, team_name, effective_from, effective_until
- **Will Store**: Team 10 name change in Week 3

### ✅ Data Sources Available

1. **lineups.csv** (3,115 rows)
   - Weeks 1-8, both primary and bonus games
   - All 10 teams, complete player roster per week
   - ESPN IDs for player matching

2. **Database Queries Completed**:
   - Draft picks (53 players drafted on 8/31/2025)
   - ESPN ID mapping (944 players)
   - Current roster status per team
   - Foreign key constraints documented
   - Trade history (5 completed trades)

3. **Activity Logs**:
   - ROSTER_RESET_TO_KEEPERS entries from 8/25/2025 showing keeper counts:
     - Team 1: 12, Team 2: 11, Team 3: 12, Team 4: 12, Team 5: 13
     - Team 6: 12, Team 7: 13, Team 8: 12, Team 9: 12, Team 10: 11
     - **Total: 120 keepers**

---

## What Remains To Be Done

### 📋 Phase 2: Data Backfill (IMMEDIATE PRIORITY)

#### Step 1: Reconstruct Original 120 Keepers
**Algorithm**:
1. Extract all Week 1 primary lineup players from CSV
2. Match players to database via ESPN ID
3. Remove the 53 drafted players (we have the list)
4. Remaining players = the 120 original keepers
5. INSERT into `historical_keepers` with designation_date = '2025-08-25 14:30:48'

**Script Needed**: Python script to:
- Parse lineups.csv
- Match ESPN IDs to player_id
- Generate INSERT statements for `historical_keepers`

#### Step 2: Backfill Historical Rosters
**Algorithm**:
1. For each keeper: Create `historical_rosters` entry with:
   - active_from = '2025-08-25 14:30:48'
   - acquisition_type = 'Keeper'
   - was_keeper = 1
2. For each drafted player: Create entry with:
   - active_from = acquisition_date (from fantasy_team_players)
   - acquisition_type = 'Draft'
3. For traded players: Create TWO entries:
   - One with active_until = trade_date (old team)
   - One with active_from = trade_date (new team)
4. For current players: active_until = NULL

**Data Sources**:
- Current `fantasy_team_players` table
- `trades` + `trade_items` tables
- Reconstructed keeper list from Step 1

#### Step 3: Import 8 Weeks of Historical Lineups
**Algorithm**:
1. Parse all 3,115 rows from lineups.csv
2. For each lineup entry:
   - Match ESPN ID to player_id
   - Determine acquisition_type from historical_rosters
   - Insert into `historical_lineups`

**Script Needed**: Python script to:
- Parse CSV
- Match ESPN IDs
- Cross-reference historical_rosters for acquisition context
- Generate INSERT statements

#### Step 4: Backfill Team Name History
**Simple Query**:
```sql
-- Team 10 name change in Week 3
INSERT INTO historical_team_names (fantasy_team_id, team_name, effective_from, effective_until)
VALUES
(10, 'Manstraighting to Seven', '2025-08-01 00:00:00', '2025-09-15 00:00:00'),
(10, 'Rough Rodgers Goes Riding', '2025-09-15 00:00:00', NULL);

-- All other teams (current name since season start)
INSERT INTO historical_team_names (fantasy_team_id, team_name, effective_from, effective_until)
SELECT team_id, team_name, '2025-08-01 00:00:00', NULL
FROM fantasy_teams
WHERE team_id != 10;
```

---

### 📋 Phase 3: Application Updates (AFTER BACKFILL)

#### Critical Code Changes Needed

##### 1. **Stop Deleting Records** - Use Soft Deletes
**File**: `models/FantasyTeam.js`

**Current Code (Line 273)**:
```javascript
const result = await db.query(
  'DELETE FROM fantasy_team_players WHERE fantasy_team_id = ? AND player_id = ?',
  [teamId, playerId]
);
```

**New Approach**: Keep record in fantasy_team_players, but ALSO:
```javascript
// Option A: Just add to historical_rosters with end date
await db.query(
  `INSERT INTO historical_rosters
   (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
    acquisition_type, acquisition_date, was_keeper, notes)
   SELECT 2025, ftp.fantasy_team_id, ftp.player_id, np.espn_id,
          ftp.acquisition_date, NOW(), ftp.acquisition_type, ftp.acquisition_date,
          ftp.is_keeper, 'Player dropped'
   FROM fantasy_team_players ftp
   JOIN nfl_players np ON ftp.player_id = np.player_id
   WHERE ftp.fantasy_team_id = ? AND ftp.player_id = ?`,
  [teamId, playerId]
);

// Then do the delete (preserving current system behavior)
await db.query('DELETE FROM fantasy_team_players WHERE fantasy_team_id = ? AND player_id = ?',
  [teamId, playerId]);
```

##### 2. **Track Trades in Historical Rosters**
**Location**: Wherever trades are processed (likely `tradeController.js`)

**Add After Trade Completion**:
```javascript
// For each player in the trade
for (const tradeItem of tradeItems) {
  if (tradeItem.item_type === 'Player') {
    // Close out old team record
    await db.query(
      `INSERT INTO historical_rosters
       (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
        acquisition_type, acquisition_date, was_keeper, traded_to_team_id, related_trade_id)
       SELECT 2025, ftp.fantasy_team_id, ftp.player_id, np.espn_id,
              ftp.acquisition_date, NOW(), ftp.acquisition_type, ftp.acquisition_date,
              ftp.is_keeper, ?, ?
       FROM fantasy_team_players ftp
       JOIN nfl_players np ON ftp.player_id = np.player_id
       WHERE ftp.player_id = ? AND ftp.fantasy_team_id = ?`,
      [tradeItem.to_team_id, trade_id, tradeItem.player_id, tradeItem.from_team_id]
    );

    // Create new team record
    await db.query(
      `INSERT INTO historical_rosters
       (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
        acquisition_type, acquisition_date, was_keeper, acquired_from_team_id, related_trade_id)
       SELECT 2025, ?, ftp.player_id, np.espn_id, NOW(), NULL, 'Trade', NOW(),
              ftp.is_keeper, ?, ?
       FROM fantasy_team_players ftp
       JOIN nfl_players np ON ftp.player_id = np.player_id
       WHERE ftp.player_id = ?`,
      [tradeItem.to_team_id, tradeItem.from_team_id, trade_id, tradeItem.player_id]
    );
  }
}
```

##### 3. **Save Lineups to Historical Table**
**Location**: Wherever lineup submissions are saved

**Add After Lineup Save**:
```javascript
// After saving to lineup_submissions and lineup_positions
await db.query(
  `INSERT INTO historical_lineups
   (season_year, week_number, game_type, fantasy_team_id, team_name_at_time,
    owner_name_at_time, player_id, espn_id, player_name_at_time, position,
    lineup_position, acquisition_type, was_keeper, submitted_at, is_locked)
   SELECT
     ?, ?, ?, ls.fantasy_team_id, ft.team_name, u.username,
     lp.player_id, np.espn_id, np.display_name, np.position,
     CONCAT(lp.position_type, lp.sort_order) as lineup_position,
     ftp.acquisition_type, ftp.is_keeper, ls.submitted_at, ls.is_locked
   FROM lineup_submissions ls
   JOIN lineup_positions lp ON ls.lineup_id = lp.lineup_id
   JOIN fantasy_teams ft ON ls.fantasy_team_id = ft.team_id
   JOIN users u ON ft.user_id = u.user_id
   JOIN nfl_players np ON lp.player_id = np.player_id
   LEFT JOIN fantasy_team_players ftp ON lp.player_id = ftp.player_id
     AND ls.fantasy_team_id = ftp.fantasy_team_id
   WHERE ls.lineup_id = ?`,
  [seasonYear, weekNumber, gameType, savedLineupId]
);
```

##### 4. **Display Historical Lineups** - Fix The UI
**Problem**: Past lineups currently query `lineup_positions` and try to join to `fantasy_team_players`, but traded players don't match.

**Solution**: Query `historical_lineups` instead for past weeks:
```javascript
// Old way (broken for traded players):
const lineup = await db.query(`
  SELECT lp.*, np.display_name, ftp.acquisition_type
  FROM lineup_positions lp
  JOIN nfl_players np ON lp.player_id = np.player_id
  LEFT JOIN fantasy_team_players ftp ON lp.player_id = ftp.player_id
  WHERE lp.lineup_id = ?
`);

// New way (always works):
const lineup = await db.query(`
  SELECT * FROM historical_lineups
  WHERE fantasy_team_id = ? AND week_number = ? AND game_type = ?
  ORDER BY lineup_position
`, [teamId, weekNumber, gameType]);
```

##### 5. **Keeper Designation Snapshot**
**When**: At keeper deadline (before draft)

**Add to Admin Function**:
```javascript
async function snapshotKeepersForSeason(seasonYear) {
  await db.query(
    `INSERT INTO historical_keepers
     (season_year, fantasy_team_id, player_id, espn_id, designation_date,
      original_acquisition_type, original_acquisition_date)
     SELECT ?, ftp.fantasy_team_id, ftp.player_id, np.espn_id, NOW(),
            ftp.acquisition_type, ftp.acquisition_date
     FROM fantasy_team_players ftp
     JOIN nfl_players np ON ftp.player_id = np.player_id
     WHERE ftp.is_keeper = 1
     ON DUPLICATE KEY UPDATE player_id = player_id`,
    [seasonYear]
  );
}
```

---

## Testing Plan

### Phase 2 Testing (Data Backfill)
1. ✅ Verify 120 keepers inserted into `historical_keepers`
2. ✅ Count `historical_rosters` entries (should be ~210+ for keepers + drafts + trades)
3. ✅ Count `historical_lineups` entries (should be 3,115 from CSV)
4. ✅ Verify Team 10 name change in `historical_team_names`

### Phase 3 Testing (Application Updates)
1. **Test Trade**: Execute a trade, verify:
   - Two entries created in `historical_rosters` (one ending, one starting)
   - `active_until` set correctly on old team
   - `active_from` set correctly on new team

2. **Test Drop**: Drop a player, verify:
   - Entry created in `historical_rosters` with `active_until = NOW()`

3. **Test Lineup Submission**: Submit a lineup for current week, verify:
   - All players saved to `historical_lineups`
   - `team_name_at_time` matches current team name
   - `acquisition_type` populated correctly

4. **Test Historical View**: View a past week's lineup, verify:
   - All players display (including those since traded)
   - Correct team name shown (even if team renamed)
   - Acquisition type displayed correctly

---

## Query Examples for Verification

### Check Original Keepers
```sql
SELECT
    ft.team_name,
    COUNT(*) as keeper_count
FROM historical_keepers hk
JOIN fantasy_teams ft ON hk.fantasy_team_id = ft.team_id
WHERE hk.season_year = 2025
GROUP BY ft.team_name
ORDER BY ft.team_name;
-- Should show: 12,11,12,12,13,12,13,12,12,11 = 120 total
```

### View Week 1 Lineup (with historical context)
```sql
SELECT
    hl.team_name_at_time,
    hl.lineup_position,
    hl.player_name_at_time,
    hl.acquisition_type,
    CASE WHEN hl.was_keeper = 1 THEN 'Yes' ELSE 'No' END as was_keeper
FROM historical_lineups hl
WHERE hl.fantasy_team_id = 1
  AND hl.week_number = 1
  AND hl.game_type = 'primary'
ORDER BY hl.lineup_position;
```

### Find Players Who Were Traded
```sql
SELECT
    np.display_name,
    ft_from.team_name as from_team,
    ft_to.team_name as to_team,
    hr.active_from as joined_new_team,
    hr.was_keeper
FROM historical_rosters hr
JOIN nfl_players np ON hr.player_id = np.player_id
JOIN fantasy_teams ft_to ON hr.fantasy_team_id = ft_to.team_id
LEFT JOIN fantasy_teams ft_from ON hr.acquired_from_team_id = ft_from.team_id
WHERE hr.acquisition_type = 'Trade'
  AND hr.season_year = 2025
ORDER BY hr.active_from;
```

### View Complete Roster History for a Player
```sql
SELECT
    np.display_name,
    ft.team_name,
    hr.acquisition_type,
    hr.active_from,
    hr.active_until,
    CASE WHEN hr.active_until IS NULL THEN 'Current' ELSE 'Past' END as status
FROM historical_rosters hr
JOIN nfl_players np ON hr.player_id = np.player_id
JOIN fantasy_teams ft ON hr.fantasy_team_id = ft.team_id
WHERE np.display_name = 'Brock Purdy'
  AND hr.season_year = 2025
ORDER BY hr.active_from;
```

---

## Files Modified/Created

### Created:
- ✅ `historical_keepers` table
- ✅ `historical_rosters` table
- ✅ `historical_lineups` table
- ✅ `historical_team_names` table

### Need to Modify (Phase 3):
- `models/FantasyTeam.js` (removePlayerFromRoster, addPlayerToRoster)
- Trade processing code (likely `controllers/tradeController.js`)
- Lineup submission code (need to identify file)
- Lineup display code (need to identify file)

---

## Rollback Plan

If something goes wrong:

### During Phase 2 (Backfill):
```sql
-- Safe to drop and recreate:
DROP TABLE IF EXISTS historical_lineups;
DROP TABLE IF EXISTS historical_rosters;
DROP TABLE IF EXISTS historical_keepers;
DROP TABLE IF EXISTS historical_team_names;
-- Then re-run creation scripts
```

### During Phase 3 (Application Updates):
- All new historical tables are **additive only**
- Existing tables (`fantasy_team_players`, `lineup_positions`) remain unchanged
- Can roll back code changes without data loss
- Historical tables can be rebuilt from CSV at any time

---

## Next Session Checklist

1. **Create Python Script** to:
   - Parse lineups.csv
   - Match ESPN IDs to database player_id
   - Identify 120 original keepers (Week 1 players minus 53 drafted)
   - Generate INSERT statements for `historical_keepers`

2. **Create SQL Script** to:
   - Backfill `historical_rosters` from current state + trades
   - Import all lineups to `historical_lineups`
   - Add team name history to `historical_team_names`

3. **Identify Code Files** that handle:
   - Trade execution
   - Lineup submission
   - Lineup display (past weeks)

4. **Update Application Code** per Phase 3 plan above

5. **Test Everything** using verification queries

---

## Key Design Decisions

1. **Non-Destructive Approach**: All existing tables remain unchanged, minimizing risk
2. **Dual System**: Historical tables run alongside current tables until fully tested
3. **ESPN ID as Bridge**: Using ESPN IDs to match CSV data to database records
4. **Temporal Tracking**: `active_from`/`active_until` pattern allows point-in-time queries
5. **Snapshot at Time**: `historical_lineups` captures team/player names at submission time
6. **Trade Tracking**: Both "from" and "to" sides of trades recorded

---

## Contact/Questions

- **Current Status**: Tables created, ready for data backfill
- **Blocking Issue**: Need Python script to process CSV and generate INSERTs
- **Estimated Time**:
  - Phase 2 (backfill): 2-4 hours
  - Phase 3 (code updates): 4-6 hours
  - Testing: 2 hours
- **Total**: ~10 hours remaining work

---

**Last Updated**: October 29, 2025
**Ready for**: Data backfill scripting
