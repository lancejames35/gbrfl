-- Insert Missing Keepers
-- Total: 14 keepers

INSERT INTO historical_keepers
  (season_year, fantasy_team_id, player_id, espn_id, designation_date)
VALUES
  (2025, 1, 282, 4429955, '2025-08-25 14:30:48'),  -- Team 1: Will Howard (QB)
  (2025, 2, 691, 4430737, '2025-08-25 14:30:48'),  -- Team 2: Kyren Williams (RB)
  (2025, 2, 53, 4429013, '2025-08-25 14:30:48'),  -- Team 2: Tank Bigsby (RB)
  (2025, 2, 269, 4038441, '2025-08-25 14:30:48'),  -- Team 2: Justice Hill (RB)
  (2025, 2, 289, 3059915, '2025-08-25 14:30:48'),  -- Team 2: Kareem Hunt (RB)
  (2025, 2, 499, 4360238, '2025-08-25 14:30:48'),  -- Team 2: Dameon Pierce (RB)
  (2025, 3, 552, 5081397, '2025-08-25 14:30:48'),  -- Team 3: Dylan Sampson (RB)
  (2025, 3, 539, 4362619, '2025-08-25 14:30:48'),  -- Team 3: Chris Rodriguez Jr. (RB)
  (2025, 4, 700, 14881, '2025-08-25 14:30:48'),  -- Team 4: Russell Wilson (QB)
  (2025, 5, 120, 3045147, '2025-08-25 14:30:48'),  -- Team 5: James Conner (RB)
  (2025, 6, 241, 4372561, '2025-08-25 14:30:48'),  -- Team 6: Isaac Guerendo (RB)
  (2025, 7, 571, 4373678, '2025-08-25 14:30:48'),  -- Team 7: Khalil Shakir (RC)
  (2025, 8, 511, 4361741, '2025-08-25 14:30:48'),  -- Team 8: Brock Purdy (QB)
  (2025, 8, 177, 3068267, '2025-08-25 14:30:48');  -- Team 8: Austin Ekeler (RB)

-- Verification
SELECT fantasy_team_id, COUNT(*) FROM historical_keepers WHERE season_year = 2025 GROUP BY fantasy_team_id ORDER BY fantasy_team_id;
