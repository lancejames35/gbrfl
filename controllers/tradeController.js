/**
 * Trade Controller
 * Handles trade proposal and approval functionality
 */

const { validationResult } = require('express-validator');
const db = require('../config/database');
const NotificationTriggers = require('../models/NotificationTriggers');

/**
 * Submit a trade proposal
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.proposeTrade = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { target_team_id, trade_items } = req.body;
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id, team_name
      FROM fantasy_teams
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);

    if (!userTeams || userTeams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You do not have a fantasy team'
      });
    }

    const proposing_team_id = userTeams[0].team_id;

    // Validate target team exists and is different
    if (proposing_team_id === parseInt(target_team_id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot trade with yourself'
      });
    }

    const targetTeamQuery = `SELECT team_name FROM fantasy_teams WHERE team_id = ?`;
    const targetTeams = await db.query(targetTeamQuery, [target_team_id]);

    if (targetTeams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Target team not found'
      });
    }

    // Validate trade items
    if (!trade_items || !Array.isArray(trade_items) || trade_items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Trade must include at least one item'
      });
    }

    // Validate roster sizes before creating trade
    const rosterValidation = await validatePostTradeRosterSizes(proposing_team_id, target_team_id, trade_items);
    if (!rosterValidation.valid) {
      // Check if proposing team would be oversized (they need to select drops during proposal)
      const proposingTeamOversized = rosterValidation.oversizedTeams.find(team => team.team_id === proposing_team_id);
      if (proposingTeamOversized) {
        const { drop_players = [] } = req.body;
        if (drop_players.length !== proposingTeamOversized.players_to_drop) {
          return res.status(400).json({
            success: false,
            message: `You must select ${proposingTeamOversized.players_to_drop} player(s) to drop before proposing this trade`,
            oversizedTeam: proposingTeamOversized,
            requireDropSelection: true
          });
        }
      }
      // For target team oversized scenario, that will be handled when they accept the trade
    }

    // Start transaction
    const conn = await db.pool.getConnection();
    await conn.beginTransaction();

    try {
      // Create trade proposal
      const insertTradeQuery = `
        INSERT INTO trades (proposing_team_id, target_team_id, status, notes)
        VALUES (?, ?, 'Proposed', ?)
      `;

      const tradeNotes = `Trade proposal from ${userTeams[0].team_name} to ${targetTeams[0].team_name}`;
      const tradeResult = await conn.query(insertTradeQuery, [
        proposing_team_id,
        target_team_id,
        tradeNotes
      ]);

      // Handle mysql2 connection result format
      console.log('Trade insert result:', tradeResult);

      // Raw connection query returns [results, fields], so we need the first element
      const trade_id = tradeResult[0]?.insertId || tradeResult.insertId;

      console.log('Extracted trade_id:', trade_id);
      if (!trade_id) {
        console.error('Full tradeResult object:', JSON.stringify(tradeResult, null, 2));
        throw new Error('Failed to create trade record - no insertId returned');
      }

      // Add trade items
      for (const item of trade_items) {
        await validateAndInsertTradeItem(conn, trade_id, item, proposing_team_id, target_team_id);
      }

      // Store drop players if proposing team needed to select them
      const { drop_players = [] } = req.body;
      if (drop_players.length > 0) {
        const dropPlayersData = drop_players.map(player_id => [trade_id, proposing_team_id, player_id]);
        const insertDropQuery = `
          INSERT INTO trade_drop_players (trade_id, team_id, player_id)
          VALUES ?
        `;
        await conn.query(insertDropQuery, [dropPlayersData]);
      }

      await conn.commit();

      // Send notification to target team owner
      try {
        await NotificationTriggers.notifyTradeProposed(trade_id, proposing_team_id, target_team_id);
      } catch (notificationError) {
        console.warn('Warning: Could not send trade proposal notification:', notificationError.message);
      }

      // Log the activity
      try {
        const activityQuery = `
          INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
          VALUES (?, 'trade_proposed', 'trade', ?, ?)
        `;
        const activityDetails = JSON.stringify({
          trade_id: trade_id,
          target_team: targetTeams[0].team_name,
          item_count: trade_items.length
        });

        await db.query(activityQuery, [user_id, trade_id, activityDetails]);
      } catch (logError) {
        console.warn('Warning: Could not log trade proposal activity:', logError.message);
      }

      res.json({
        success: true,
        message: `Trade proposal submitted to ${targetTeams[0].team_name}`,
        trade_id: trade_id
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

  } catch (error) {
    console.error('Error submitting trade proposal:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting trade proposal',
      error: error.message
    });
  }
};

/**
 * Validate and insert a trade item
 */
async function validateAndInsertTradeItem(conn, trade_id, item, proposing_team_id, target_team_id) {
  const { from_team_id, to_team_id, item_type, player_id, draft_year, draft_round, keeper_slots, free_agent_round, free_agent_week } = item;

  // Validate team ownership
  if (from_team_id !== proposing_team_id && from_team_id !== target_team_id) {
    throw new Error('Invalid from_team_id');
  }
  if (to_team_id !== proposing_team_id && to_team_id !== target_team_id) {
    throw new Error('Invalid to_team_id');
  }
  if (from_team_id === to_team_id) {
    throw new Error('Cannot trade to the same team');
  }

  // Validate item based on type
  switch (item_type) {
    case 'Player':
      if (!player_id) throw new Error('Player ID required for player trades');

      // Verify player belongs to from_team
      const playerCheck = await conn.query(
        'SELECT COUNT(*) as count FROM fantasy_team_players WHERE fantasy_team_id = ? AND player_id = ?',
        [from_team_id, player_id]
      );
      if (playerCheck[0].count === 0) {
        throw new Error('Player not found on the specified team');
      }
      break;

    case 'Draft Pick':
      if (!draft_year || !draft_round) throw new Error('Draft year and round required for draft pick trades');
      if (draft_year < 2026 || draft_year > 2028) throw new Error('Draft year must be 2026, 2027, or 2028');
      if (draft_round < 1 || draft_round > 10) throw new Error('Draft round must be between 1 and 10');
      break;

    case 'Keeper Slot':
      if (!keeper_slots || keeper_slots < 1) throw new Error('Number of keeper slots required');

      // Verify team has enough keeper slots
      const keeperCheck = await conn.query(
        'SELECT (base_slots + additional_slots) as total_slots FROM team_keeper_slots WHERE fantasy_team_id = ? AND season_year = 2025',
        [from_team_id]
      );
      if (keeperCheck.length === 0 || keeperCheck[0].total_slots < keeper_slots) {
        throw new Error('Team does not have enough keeper slots to trade');
      }
      break;

    case 'Free Agent Pick':
      if (!free_agent_round || !free_agent_week) throw new Error('Free agent round and week required');
      if (free_agent_round !== 1 && free_agent_round !== 2) throw new Error('Free agent round must be 1 or 2');
      break;

    default:
      throw new Error('Invalid item type');
  }

  // Insert trade item
  const insertItemQuery = `
    INSERT INTO trade_items (
      trade_id, from_team_id, to_team_id, item_type, player_id,
      draft_round, draft_year, season_year, keeper_slots,
      free_agent_round, free_agent_week
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 2025, ?, ?, ?)
  `;

  await conn.query(insertItemQuery, [
    trade_id, from_team_id, to_team_id, item_type, player_id,
    draft_round, draft_year, keeper_slots, free_agent_round, free_agent_week
  ]);
}

/**
 * Get all pending trade proposals for admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAdminPendingTrades = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.session.user.isAdmin) {
      req.flash('error_msg', 'Admin access required');
      return res.redirect('/dashboard');
    }

    // Get all pending trades with team details
    const tradesQuery = `
      SELECT
        t.trade_id,
        t.proposal_date,
        t.notes,
        t.proposing_team_id,
        t.target_team_id,
        ft1.team_name as proposing_team_name,
        ft2.team_name as target_team_name,
        u1.first_name as proposing_first_name,
        u1.last_name as proposing_last_name,
        u2.first_name as target_first_name,
        u2.last_name as target_last_name
      FROM trades t
      JOIN fantasy_teams ft1 ON t.proposing_team_id = ft1.team_id
      JOIN fantasy_teams ft2 ON t.target_team_id = ft2.team_id
      JOIN users u1 ON ft1.user_id = u1.user_id
      JOIN users u2 ON ft2.user_id = u2.user_id
      WHERE t.status = 'Accepted'
      ORDER BY t.proposal_date ASC
    `;

    const trades = await db.query(tradesQuery);

    // Get trade items for each trade
    for (let trade of trades) {
      const itemsQuery = `
        SELECT
          ti.*,
          p.display_name as player_name,
          p.position as player_position,
          ft1.team_name as from_team_name,
          ft2.team_name as to_team_name
        FROM trade_items ti
        LEFT JOIN nfl_players p ON ti.player_id = p.player_id
        LEFT JOIN fantasy_teams ft1 ON ti.from_team_id = ft1.team_id
        LEFT JOIN fantasy_teams ft2 ON ti.to_team_id = ft2.team_id
        WHERE ti.trade_id = ?
        ORDER BY ti.from_team_id, ti.item_type
      `;

      trade.items = await db.query(itemsQuery, [trade.trade_id]);
    }

    res.render('admin/trades', {
      title: 'Admin - Trade Proposals',
      trades,
      activePage: 'admin-trades',
      user: req.session.user
    });

  } catch (error) {
    console.error('Error getting admin pending trades:', error);
    req.flash('error_msg', 'Error loading trade proposals');
    res.redirect('/dashboard');
  }
};

/**
 * Approve a trade proposal
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.approveTrade = async (req, res) => {
  try {
    const trade_id = req.params.id;
    const admin_user_id = req.session.user.id;

    // Check if user is admin
    if (!req.session.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Get trade details
    const tradeQuery = `
      SELECT t.*, ft1.team_name as proposing_team_name, ft2.team_name as target_team_name
      FROM trades t
      JOIN fantasy_teams ft1 ON t.proposing_team_id = ft1.team_id
      JOIN fantasy_teams ft2 ON t.target_team_id = ft2.team_id
      WHERE t.trade_id = ? AND t.status = 'Proposed'
    `;
    const tradeResults = await db.query(tradeQuery, [trade_id]);

    if (tradeResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already processed'
      });
    }

    const trade = tradeResults[0];

    // Get trade items
    const itemsQuery = `
      SELECT * FROM trade_items WHERE trade_id = ?
    `;
    const items = await db.query(itemsQuery, [trade_id]);

    // Validate roster sizes after trade
    const rosterValidation = await validatePostTradeRosterSizes(trade.proposing_team_id, trade.target_team_id, items);
    if (!rosterValidation.valid) {
      return res.status(400).json({
        success: false,
        message: rosterValidation.message,
        oversizedTeams: rosterValidation.oversizedTeams
      });
    }

    // Start transaction
    const conn = await db.pool.getConnection();
    await conn.beginTransaction();

    try {
      // Execute the trade
      await executeTrade(conn, trade_id, items);

      // Update trade status
      const updateTradeQuery = `
        UPDATE trades
        SET status = 'Completed', completion_date = NOW(), processed_by = ?
        WHERE trade_id = ?
      `;
      await conn.query(updateTradeQuery, [admin_user_id, trade_id]);

      // Record in unified transactions table
      await recordTradeTransaction(conn, trade, items, admin_user_id);

      await conn.commit();

      // Send notifications to both teams
      try {
        // Get user IDs for both teams
        const proposingUser = await db.query('SELECT user_id FROM fantasy_teams WHERE team_id = ?', [trade.proposing_team_id]);
        const targetUser = await db.query('SELECT user_id FROM fantasy_teams WHERE team_id = ?', [trade.target_team_id]);

        if (proposingUser.length > 0) {
          await NotificationTriggers.notifyTradeStatusChanged(trade_id, 'Completed', proposingUser[0].user_id, 'Admin');
        }
        if (targetUser.length > 0) {
          await NotificationTriggers.notifyTradeStatusChanged(trade_id, 'Completed', targetUser[0].user_id, 'Admin');
        }
      } catch (notificationError) {
        console.warn('Warning: Could not send trade approval notifications:', notificationError.message);
      }

      // Log the activity
      try {
        const activityQuery = `
          INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
          VALUES (?, 'trade_approved', 'trade', ?, ?)
        `;
        const activityDetails = JSON.stringify({
          trade_id: trade_id,
          proposing_team: trade.proposing_team_name,
          target_team: trade.target_team_name,
          approved_by: admin_user_id
        });

        await db.query(activityQuery, [admin_user_id, trade_id, activityDetails]);
      } catch (logError) {
        console.warn('Warning: Could not log trade approval activity:', logError.message);
      }

      res.json({
        success: true,
        message: 'Trade approved and executed successfully'
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

  } catch (error) {
    console.error('Error approving trade:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving trade'
    });
  }
};

/**
 * Accept a trade proposal (team response)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.acceptTrade = async (req, res) => {
  try {
    const trade_id = req.params.id;
    const { drop_players = [] } = req.body; // Players to drop if roster would exceed limit

    // Get trade details and verify user can accept it
    const tradeQuery = `
      SELECT t.*, ft1.team_name as proposing_team_name, ft2.team_name as target_team_name,
             ft2.user_id as target_user_id, ft1.user_id as proposing_user_id
      FROM trades t
      JOIN fantasy_teams ft1 ON t.proposing_team_id = ft1.team_id
      JOIN fantasy_teams ft2 ON t.target_team_id = ft2.team_id
      WHERE t.trade_id = ? AND t.status = 'Proposed'
    `;
    const tradeResults = await db.query(tradeQuery, [trade_id]);

    if (tradeResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already processed'
      });
    }

    const trade = tradeResults[0];

    // Verify the user owns the target team
    if (trade.target_user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only accept trades proposed to your team'
      });
    }

    // Get trade items to validate roster size
    const itemsQuery = `SELECT * FROM trade_items WHERE trade_id = ?`;
    const items = await db.query(itemsQuery, [trade_id]);

    // Validate roster sizes for target team (the one accepting)
    const rosterValidation = await validatePostTradeRosterSizes(trade.proposing_team_id, trade.target_team_id, items);
    if (!rosterValidation.valid) {
      // Check if target team would be oversized
      const targetTeamOversized = rosterValidation.oversizedTeams.find(team => team.team_id === trade.target_team_id);
      if (targetTeamOversized) {
        if (drop_players.length !== targetTeamOversized.players_to_drop) {
          return res.status(400).json({
            success: false,
            message: `You must select ${targetTeamOversized.players_to_drop} player(s) to drop`,
            oversizedTeam: targetTeamOversized
          });
        }
      }
    }

    // Start transaction
    const conn = await db.pool.getConnection();
    await conn.beginTransaction();

    try {
      // Update trade status to Accepted
      const updateTradeQuery = `
        UPDATE trades
        SET status = 'Accepted', accepted_date = NOW(), accepted_by = ?
        WHERE trade_id = ?
      `;
      await conn.query(updateTradeQuery, [req.user.id, trade_id]);

      // Store drop players if any
      if (drop_players.length > 0) {
        const dropPlayersData = drop_players.map(player_id => [trade_id, trade.target_team_id, player_id]);
        const insertDropQuery = `
          INSERT INTO trade_drop_players (trade_id, team_id, player_id)
          VALUES ?
        `;
        await conn.query(insertDropQuery, [dropPlayersData]);
      }

      // Log activity
      const activityQuery = `
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'accept', 'trade', ?, ?)
      `;
      await conn.query(activityQuery, [
        req.user.id,
        trade_id,
        JSON.stringify({
          trade_id,
          from_team: trade.proposing_team_name,
          to_team: trade.target_team_name,
          drop_players: drop_players.length
        })
      ]);

      await conn.commit();

      // Send notifications
      await NotificationTriggers.notifyTradeStatusChanged(trade_id, 'Accepted', trade.proposing_user_id, `${req.user.first_name} ${req.user.last_name}`);

      res.json({
        success: true,
        message: `Trade accepted! It has been sent to the admin for final approval.`
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

  } catch (error) {
    console.error('Error accepting trade:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting trade proposal',
      error: error.message
    });
  }
};

/**
 * Reject a trade proposal (team response)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.rejectTrade = async (req, res) => {
  try {
    const trade_id = req.params.id;
    const { rejection_reason } = req.body;

    // Get trade details and verify user can reject it
    const tradeQuery = `
      SELECT t.*, ft1.team_name as proposing_team_name, ft2.team_name as target_team_name,
             ft2.user_id as target_user_id, ft1.user_id as proposing_user_id
      FROM trades t
      JOIN fantasy_teams ft1 ON t.proposing_team_id = ft1.team_id
      JOIN fantasy_teams ft2 ON t.target_team_id = ft2.team_id
      WHERE t.trade_id = ? AND t.status = 'Proposed'
    `;
    const tradeResults = await db.query(tradeQuery, [trade_id]);

    if (tradeResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already processed'
      });
    }

    const trade = tradeResults[0];

    // Verify the user owns the target team
    if (trade.target_user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only reject trades proposed to your team'
      });
    }

    // Update trade status to Rejected
    const updateTradeQuery = `
      UPDATE trades
      SET status = 'Rejected', rejected_date = NOW(), rejected_by = ?, rejection_reason = ?
      WHERE trade_id = ?
    `;
    await db.query(updateTradeQuery, [req.user.id, rejection_reason || null, trade_id]);

    // Log activity
    const activityQuery = `
      INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'reject', 'trade', ?, ?)
    `;
    await db.query(activityQuery, [
      req.user.id,
      trade_id,
      JSON.stringify({
        trade_id,
        from_team: trade.proposing_team_name,
        to_team: trade.target_team_name,
        reason: rejection_reason
      })
    ]);

    // Send notification to proposing team
    await NotificationTriggers.notifyTradeStatusChanged(trade_id, 'Rejected', trade.proposing_user_id, `${req.user.first_name} ${req.user.last_name}`);

    res.json({
      success: true,
      message: 'Trade proposal rejected successfully'
    });

  } catch (error) {
    console.error('Error rejecting trade:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting trade proposal',
      error: error.message
    });
  }
};

/**
 * Execute trade by moving players and updating keeper slots
 */
async function executeTrade(conn, trade_id, items) {
  for (const item of items) {
    switch (item.item_type) {
      case 'Player':
        // Save player's current roster info to historical_rosters before removing
        await conn.query(`
          INSERT INTO historical_rosters
          (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
           acquisition_type, acquisition_date, was_keeper, notes)
          SELECT YEAR(CURDATE()), ftp.fantasy_team_id, ftp.player_id, np.espn_id,
                 ftp.acquisition_date, NOW(), ftp.acquisition_type, ftp.acquisition_date,
                 ftp.is_keeper, CONCAT('Traded to team ', ?)
          FROM fantasy_team_players ftp
          JOIN nfl_players np ON ftp.player_id = np.player_id
          WHERE ftp.fantasy_team_id = ? AND ftp.player_id = ?
        `, [item.to_team_id, item.from_team_id, item.player_id]);

        // Remove player from original team
        await conn.query(
          'DELETE FROM fantasy_team_players WHERE fantasy_team_id = ? AND player_id = ?',
          [item.from_team_id, item.player_id]
        );

        // Add player to new team
        await conn.query(
          'INSERT INTO fantasy_team_players (fantasy_team_id, player_id, acquisition_type) VALUES (?, ?, ?)',
          [item.to_team_id, item.player_id, 'Trade']
        );

        // Save player's new roster info to historical_rosters
        await conn.query(`
          INSERT INTO historical_rosters
          (season_year, fantasy_team_id, player_id, espn_id, active_from, active_until,
           acquisition_type, acquisition_date, was_keeper, notes)
          SELECT YEAR(CURDATE()), ftp.fantasy_team_id, ftp.player_id, np.espn_id,
                 NOW(), NULL, ftp.acquisition_type, ftp.acquisition_date,
                 ftp.is_keeper, CONCAT('Acquired via trade from team ', ?)
          FROM fantasy_team_players ftp
          JOIN nfl_players np ON ftp.player_id = np.player_id
          WHERE ftp.fantasy_team_id = ? AND ftp.player_id = ?
        `, [item.from_team_id, item.to_team_id, item.player_id]);
        break;

      case 'Keeper Slot':
        // Update keeper slots for both teams
        await conn.query(
          'UPDATE team_keeper_slots SET additional_slots = additional_slots - ? WHERE fantasy_team_id = ? AND season_year = 2025',
          [item.keeper_slots, item.from_team_id]
        );

        await conn.query(
          'UPDATE team_keeper_slots SET additional_slots = additional_slots + ? WHERE fantasy_team_id = ? AND season_year = 2025',
          [item.keeper_slots, item.to_team_id]
        );
        break;

      // Draft picks and free agent picks are recorded but don't require immediate action
      case 'Draft Pick':
      case 'Free Agent Pick':
        // These will be handled manually during draft/waiver processing
        break;
    }
  }
}

/**
 * Record trade in unified transactions table
 */
async function recordTradeTransaction(conn, trade, items, admin_user_id) {
  // Create transaction record
  const transactionQuery = `
    INSERT INTO transactions (transaction_type, season_year, week, transaction_date, notes, created_by)
    VALUES ('Trade', 2025, 'Week 1', CURDATE(), ?, ?)
  `;

  const notes = `Trade: ${trade.proposing_team_name} ↔ ${trade.target_team_name}`;
  const transactionResult = await conn.query(transactionQuery, [notes, admin_user_id]);
  const transaction_id = transactionResult.insertId;

  // Add transaction relationships
  await conn.query(
    'INSERT INTO transaction_relationships (transaction_id, team_id, is_primary) VALUES (?, ?, 1)',
    [transaction_id, trade.proposing_team_id]
  );
  await conn.query(
    'INSERT INTO transaction_relationships (transaction_id, team_id, is_primary) VALUES (?, ?, 0)',
    [transaction_id, trade.target_team_id]
  );

  // Add transaction items
  for (const item of items) {
    let acquired_direction, lost_direction;

    // Determine directions for transaction_items table
    const acquiredQuery = `
      INSERT INTO transaction_items (
        transaction_id, team_id, direction, item_type, player_id,
        draft_year, draft_round, keeper_slots, free_agent_round, free_agent_week
      ) VALUES (?, ?, 'Acquired', ?, ?, ?, ?, ?, ?, ?)
    `;

    const lostQuery = `
      INSERT INTO transaction_items (
        transaction_id, team_id, direction, item_type, player_id,
        draft_year, draft_round, keeper_slots, free_agent_round, free_agent_week
      ) VALUES (?, ?, 'Lost', ?, ?, ?, ?, ?, ?, ?)
    `;

    // Team receiving the item
    await conn.query(acquiredQuery, [
      transaction_id, item.to_team_id, item.item_type, item.player_id,
      item.draft_year, item.draft_round, item.keeper_slots,
      item.free_agent_round, item.free_agent_week
    ]);

    // Team giving the item
    await conn.query(lostQuery, [
      transaction_id, item.from_team_id, item.item_type, item.player_id,
      item.draft_year, item.draft_round, item.keeper_slots,
      item.free_agent_round, item.free_agent_week
    ]);
  }
}

/**
 * Reject a trade proposal (admin action)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.adminRejectTrade = async (req, res) => {
  try {
    const trade_id = req.params.id;
    const admin_user_id = req.session.user.id;
    const { admin_notes } = req.body;

    // Check if user is admin
    if (!req.session.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Update trade status
    const updateTradeQuery = `
      UPDATE trades
      SET status = 'Rejected', processed_by = ?, admin_notes = ?
      WHERE trade_id = ? AND status = 'Proposed'
    `;
    const result = await db.query(updateTradeQuery, [admin_user_id, admin_notes || null, trade_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already processed'
      });
    }

    // Send notifications to both teams
    try {
      // Get trade details and user IDs
      const tradeDetailsQuery = `
        SELECT t.proposing_team_id, t.target_team_id,
               ft1.user_id as proposing_user_id, ft2.user_id as target_user_id
        FROM trades t
        JOIN fantasy_teams ft1 ON t.proposing_team_id = ft1.team_id
        JOIN fantasy_teams ft2 ON t.target_team_id = ft2.team_id
        WHERE t.trade_id = ?
      `;
      const tradeDetails = await db.query(tradeDetailsQuery, [trade_id]);

      if (tradeDetails.length > 0) {
        const { proposing_user_id, target_user_id } = tradeDetails[0];

        // Notify proposing team
        await NotificationTriggers.notifyTradeStatusChanged(trade_id, 'Rejected', proposing_user_id, 'Admin');

        // Notify target team
        await NotificationTriggers.notifyTradeStatusChanged(trade_id, 'Rejected', target_user_id, 'Admin');
      }
    } catch (notificationError) {
      console.warn('Warning: Could not send trade rejection notifications:', notificationError.message);
    }

    // Log the activity
    try {
      const activityQuery = `
        INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details)
        VALUES (?, 'trade_rejected', 'trade', ?, ?)
      `;
      const activityDetails = JSON.stringify({
        trade_id: trade_id,
        rejected_by: admin_user_id,
        admin_notes: admin_notes
      });

      await db.query(activityQuery, [admin_user_id, trade_id, activityDetails]);
    } catch (logError) {
      console.warn('Warning: Could not log trade rejection activity:', logError.message);
    }

    res.json({
      success: true,
      message: 'Trade proposal rejected'
    });

  } catch (error) {
    console.error('Error rejecting trade:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting trade'
    });
  }
};

/**
 * Get user's pending trades
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserTrades = async (req, res) => {
  try {
    const user_id = req.session.user.id;

    // Get user's team
    const userTeamQuery = `
      SELECT team_id, team_name
      FROM fantasy_teams
      WHERE user_id = ?
      LIMIT 1
    `;
    const userTeams = await db.query(userTeamQuery, [user_id]);

    if (userTeams.length === 0) {
      req.flash('error_msg', 'You do not have a fantasy team');
      return res.redirect('/teams');
    }

    const team_id = userTeams[0].team_id;

    // Get user's trades (both proposed and received)
    const tradesQuery = `
      SELECT
        t.*,
        ft1.team_name as proposing_team_name,
        ft2.team_name as target_team_name,
        CASE
          WHEN t.proposing_team_id = ? THEN 'proposed'
          ELSE 'received'
        END as trade_direction
      FROM trades t
      JOIN fantasy_teams ft1 ON t.proposing_team_id = ft1.team_id
      JOIN fantasy_teams ft2 ON t.target_team_id = ft2.team_id
      WHERE (t.proposing_team_id = ? OR t.target_team_id = ?)
        AND t.status != 'Cancelled'
      ORDER BY t.proposal_date DESC
    `;

    const trades = await db.query(tradesQuery, [team_id, team_id, team_id]);

    res.render('trades/user', {
      title: 'My Trades',
      team: userTeams[0],
      trades,
      activePage: 'trades',
      user: req.session.user
    });

  } catch (error) {
    console.error('Error getting user trades:', error);
    req.flash('error_msg', 'Error loading trades');
    res.redirect('/teams');
  }
};

/**
 * Validate roster sizes after a trade would be executed
 * @param {number} proposing_team_id - ID of the proposing team
 * @param {number} target_team_id - ID of the target team
 * @param {Array} items - Array of trade items
 * @returns {Object} - Validation result with valid flag and details
 */
async function validatePostTradeRosterSizes(proposing_team_id, target_team_id, items) {
  try {
    const MAX_ROSTER_SIZE = 21;

    // Get current roster sizes
    const rosterSizeQuery = `
      SELECT
        team_id,
        team_name,
        COUNT(*) as current_players
      FROM fantasy_teams ft
      LEFT JOIN fantasy_team_players ftp ON ft.team_id = ftp.fantasy_team_id
      WHERE ft.team_id IN (?, ?)
      GROUP BY ft.team_id, ft.team_name
    `;

    const currentRosters = await db.query(rosterSizeQuery, [proposing_team_id, target_team_id]);

    // Calculate net player changes for each team
    const teamChanges = {
      [proposing_team_id]: 0,
      [target_team_id]: 0
    };

    items.forEach(item => {
      if (item.item_type === 'Player') {
        // From team loses a player (-1), to team gains a player (+1)
        teamChanges[item.from_team_id]--;
        teamChanges[item.to_team_id]++;
      }
    });

    // Check if any team would exceed roster limit
    const oversizedTeams = [];

    currentRosters.forEach(roster => {
      const newRosterSize = roster.current_players + teamChanges[roster.team_id];
      if (newRosterSize > MAX_ROSTER_SIZE) {
        oversizedTeams.push({
          team_id: roster.team_id,
          team_name: roster.team_name,
          current_players: roster.current_players,
          players_after_trade: newRosterSize,
          players_to_drop: newRosterSize - MAX_ROSTER_SIZE
        });
      }
    });

    if (oversizedTeams.length > 0) {
      const teamNames = oversizedTeams.map(team => team.team_name).join(' and ');
      const message = `Trade cannot be approved: ${teamNames} would exceed the 21-player roster limit. Teams must drop players before this trade can be processed.`;

      return {
        valid: false,
        message,
        oversizedTeams
      };
    }

    return {
      valid: true,
      message: 'Roster sizes validated successfully'
    };

  } catch (error) {
    console.error('Error validating roster sizes:', error);
    return {
      valid: false,
      message: 'Error validating roster sizes'
    };
  }
}