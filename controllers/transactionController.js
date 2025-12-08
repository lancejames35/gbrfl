/**
 * Transaction Controller
 * Handles business logic for transactions
 */

const db = require('../config/database');

// Controller object
const transactionController = {};

/**
 * Render transactions page
 */
transactionController.getTransactionsPage = async (req, res) => {
  try {
    // Get all users for owner filter dropdown
    const usersResult = await db.query(`
      SELECT user_id, first_name, last_name
      FROM users
      ORDER BY first_name, last_name
    `);

    const users = Array.isArray(usersResult[0]) ? usersResult[0] : usersResult;
    console.log('Users for dropdown:', users);

    res.render('transactions', {
      title: 'GBRFL Transactions',
      users: users || [],
      activePage: 'transactions'
    });
  } catch (error) {
    console.error('Error loading transactions page:', error);
    req.flash('error_msg', 'Error loading transactions page');
    res.status(500).render('error', { 
      title: 'Server Error', 
      message: 'Failed to load transactions page' 
    });
  }
};

/**
 * Get transactions API
 * Fetches all transactions (waivers, trades, etc.) from unified transactions table
 */
transactionController.getTransactions = async (req, res) => {
  try {
    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 500; // Plenty for multi-season transaction history
    const season = req.query.season || 2025;
    const week = req.query.week || null;
    const owner = req.query.owner || null;
    const type = req.query.type || null;

    // Calculate offset for pagination
    const offset = (page - 1) * itemsPerPage;

    // Base query for all transactions from unified transactions table
    let query = `
      SELECT
        t.transaction_id,
        t.transaction_type,
        t.season_year,
        t.week,
        t.transaction_date,
        t.notes,
        tr.team_id as fantasy_team_id,
        ft.team_name,
        u.first_name,
        u.last_name,

        -- Get acquired items for this specific team (concatenated, distinct)
        GROUP_CONCAT(
          DISTINCT CASE WHEN ti_acq.direction = 'Acquired' AND ti_acq.team_id = tr.team_id
          THEN
            CASE
              WHEN ti_acq.item_type = 'Player' THEN CONCAT(p_acq.display_name, ' (', p_acq.position, ')')
              WHEN ti_acq.item_type = 'Free Agent Pick' THEN CONCAT(
                CASE
                  WHEN ti_acq.free_agent_round % 100 BETWEEN 11 AND 13 THEN CONCAT(ti_acq.free_agent_round, 'th')
                  WHEN ti_acq.free_agent_round % 10 = 1 THEN CONCAT(ti_acq.free_agent_round, 'st')
                  WHEN ti_acq.free_agent_round % 10 = 2 THEN CONCAT(ti_acq.free_agent_round, 'nd')
                  WHEN ti_acq.free_agent_round % 10 = 3 THEN CONCAT(ti_acq.free_agent_round, 'rd')
                  ELSE CONCAT(ti_acq.free_agent_round, 'th')
                END,
                ' Round Waiver Priority (Week ', ti_acq.free_agent_week, ')'
              )
              WHEN ti_acq.item_type = 'Draft Pick' THEN CONCAT(
                ti_acq.draft_year, ' ',
                CASE
                  WHEN ti_acq.draft_round % 100 BETWEEN 11 AND 13 THEN CONCAT(ti_acq.draft_round, 'th')
                  WHEN ti_acq.draft_round % 10 = 1 THEN CONCAT(ti_acq.draft_round, 'st')
                  WHEN ti_acq.draft_round % 10 = 2 THEN CONCAT(ti_acq.draft_round, 'nd')
                  WHEN ti_acq.draft_round % 10 = 3 THEN CONCAT(ti_acq.draft_round, 'rd')
                  ELSE CONCAT(ti_acq.draft_round, 'th')
                END,
                ' Round Draft Pick'
              )
              ELSE ti_acq.item_type
            END
          END
          SEPARATOR ', '
        ) as acquired_players,

        -- Get lost items for this specific team (concatenated, distinct)
        GROUP_CONCAT(
          DISTINCT CASE WHEN ti_lost.direction = 'Lost' AND ti_lost.team_id = tr.team_id
          THEN
            CASE
              WHEN ti_lost.item_type = 'Player' THEN CONCAT(p_lost.display_name, ' (', p_lost.position, ')')
              WHEN ti_lost.item_type = 'Free Agent Pick' THEN CONCAT(
                CASE
                  WHEN ti_lost.free_agent_round % 100 BETWEEN 11 AND 13 THEN CONCAT(ti_lost.free_agent_round, 'th')
                  WHEN ti_lost.free_agent_round % 10 = 1 THEN CONCAT(ti_lost.free_agent_round, 'st')
                  WHEN ti_lost.free_agent_round % 10 = 2 THEN CONCAT(ti_lost.free_agent_round, 'nd')
                  WHEN ti_lost.free_agent_round % 10 = 3 THEN CONCAT(ti_lost.free_agent_round, 'rd')
                  ELSE CONCAT(ti_lost.free_agent_round, 'th')
                END,
                ' Round Waiver Priority (Week ', ti_lost.free_agent_week, ')'
              )
              WHEN ti_lost.item_type = 'Draft Pick' THEN CONCAT(
                ti_lost.draft_year, ' ',
                CASE
                  WHEN ti_lost.draft_round % 100 BETWEEN 11 AND 13 THEN CONCAT(ti_lost.draft_round, 'th')
                  WHEN ti_lost.draft_round % 10 = 1 THEN CONCAT(ti_lost.draft_round, 'st')
                  WHEN ti_lost.draft_round % 10 = 2 THEN CONCAT(ti_lost.draft_round, 'nd')
                  WHEN ti_lost.draft_round % 10 = 3 THEN CONCAT(ti_lost.draft_round, 'rd')
                  ELSE CONCAT(ti_lost.draft_round, 'th')
                END,
                ' Round Draft Pick'
              )
              ELSE ti_lost.item_type
            END
          END
          SEPARATOR ', '
        ) as lost_players,

        -- Get attempted items for this specific team (failed waiver attempts)
        GROUP_CONCAT(
          DISTINCT CASE WHEN ti_attempted.direction = 'Attempted' AND ti_attempted.team_id = tr.team_id
          THEN
            CASE
              WHEN ti_attempted.item_type = 'Player' THEN CONCAT(p_attempted.display_name, ' (', p_attempted.position, ')')
              ELSE ti_attempted.item_type
            END
          END
          SEPARATOR ', '
        ) as attempted_players,

        -- Get first acquired player for competitor lookup (waiver only)
        MIN(CASE WHEN ti_acq.direction = 'Acquired' AND ti_acq.item_type = 'Player' AND ti_acq.team_id = tr.team_id
          THEN ti_acq.player_id END) as first_acquired_player_id

      FROM transactions t
      JOIN transaction_relationships tr ON t.transaction_id = tr.transaction_id
      JOIN fantasy_teams ft ON tr.team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id

      -- Left join for acquired items
      LEFT JOIN transaction_items ti_acq ON t.transaction_id = ti_acq.transaction_id
        AND ti_acq.direction = 'Acquired'
      LEFT JOIN nfl_players p_acq ON ti_acq.player_id = p_acq.player_id

      -- Left join for lost items
      LEFT JOIN transaction_items ti_lost ON t.transaction_id = ti_lost.transaction_id
        AND ti_lost.direction = 'Lost'
      LEFT JOIN nfl_players p_lost ON ti_lost.player_id = p_lost.player_id

      -- Left join for attempted items (failed waiver attempts)
      LEFT JOIN transaction_items ti_attempted ON t.transaction_id = ti_attempted.transaction_id
        AND ti_attempted.direction = 'Attempted'
      LEFT JOIN nfl_players p_attempted ON ti_attempted.player_id = p_attempted.player_id

      WHERE 1=1
    `;

    // Count query for pagination - count each team's perspective
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      JOIN transaction_relationships tr ON t.transaction_id = tr.transaction_id
      JOIN fantasy_teams ft ON tr.team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      WHERE 1=1
    `;

    // Build additional where conditions
    const whereConditions = [];
    const queryParams = [];

    // Filter by season
    if (season && season !== 'all') {
      whereConditions.push('t.season_year = ?');
      queryParams.push(season);
    }

    // Filter by week
    if (week && week !== 'all') {
      whereConditions.push('t.week = ?');
      queryParams.push(week);
    }

    // Filter by owner
    if (owner && owner !== 'all') {
      whereConditions.push('u.user_id = ?');
      queryParams.push(owner);
    }

    // Filter by transaction type
    if (type && type !== 'all') {
      if (type === 'waiver') {
        whereConditions.push('t.transaction_type = ?');
        queryParams.push('Waiver');
      } else if (type === 'trade') {
        whereConditions.push('t.transaction_type = ?');
        queryParams.push('Trade');
      }
    }

    // Apply where conditions to both queries
    if (whereConditions.length > 0) {
      const conditions = ' AND ' + whereConditions.join(' AND ');
      query += conditions;
      countQuery += conditions;
    }

    // Execute count query
    console.log('Count query:', countQuery);
    console.log('Query params:', queryParams);

    const [countResult] = await db.query(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    // Add grouping, ordering and pagination to main query
    // Extract week number for proper numeric sorting (handles both "Week 8" and "8" formats)
    query += `
      GROUP BY
        t.transaction_id,
        t.transaction_type,
        t.season_year,
        t.week,
        t.transaction_date,
        t.notes,
        tr.team_id,
        ft.team_name,
        u.first_name,
        u.last_name
      ORDER BY
        CAST(REGEXP_REPLACE(t.week, '[^0-9]', '') AS UNSIGNED) DESC,
        t.transaction_date DESC,
        t.transaction_id DESC,
        tr.team_id ASC
      LIMIT ${parseInt(itemsPerPage)} OFFSET ${parseInt(offset)}
    `;

    console.log('Final query:', query);

    const result = await db.query(query, queryParams);
    const transactions = Array.isArray(result[0]) ? result[0] : result;

    if (!Array.isArray(transactions)) {
      throw new Error('Query did not return an array');
    }

    console.log(`Processing ${transactions.length} transactions`);

    // For waiver transactions, get competing requests from waiver_requests table
    const transactionsWithCompetitors = await Promise.all(
      transactions.map(async (transaction) => {
        let competitors = [];

        // Only get competitors for waiver transactions
        if (transaction.transaction_type === 'Waiver' && transaction.first_acquired_player_id) {
          console.log(`Checking competitors for waiver transaction ${transaction.transaction_id}, player ID: ${transaction.first_acquired_player_id}`);

          // Find the corresponding waiver request to get waiver details
          const waiverDetailsQuery = `
            SELECT waiver_round, waiver_order_position
            FROM waiver_requests wr
            WHERE wr.pickup_player_id = ?
              AND wr.fantasy_team_id = ?
              AND wr.week = ?
              AND wr.status = 'approved'
            LIMIT 1
          `;

          const waiverDetailsResult = await db.query(waiverDetailsQuery, [
            transaction.first_acquired_player_id,
            transaction.fantasy_team_id,
            transaction.week
          ]);

          const waiverDetails = Array.isArray(waiverDetailsResult[0]) ? waiverDetailsResult[0][0] : waiverDetailsResult[0];

          if (waiverDetails) {
            // Get competing waiver requests (ALL rounds, not just the same round)
            const competingQuery = `
              SELECT
                wr.request_id,
                wr.waiver_round,
                wr.waiver_order_position,
                ft.team_name,
                u.first_name,
                u.last_name,
                drop_player.display_name as drop_name,
                wr.status,
                wr.notes
              FROM waiver_requests wr
              JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
              JOIN users u ON ft.user_id = u.user_id
              JOIN nfl_players drop_player ON wr.drop_player_id = drop_player.player_id
              WHERE wr.pickup_player_id = ?
                AND (wr.week = ? OR (wr.week IS NULL AND ? IS NULL))
                AND wr.fantasy_team_id != ?
                AND wr.status = 'rejected'
                AND (wr.notes IS NULL OR wr.notes LIKE '%Auto-rejected: Player acquired by another team%')
              ORDER BY wr.waiver_round ASC, wr.waiver_order_position ASC
            `;

            const competingResult = await db.query(competingQuery, [
              transaction.first_acquired_player_id,
              transaction.week,
              transaction.week,
              transaction.fantasy_team_id
            ]);

            competitors = Array.isArray(competingResult[0]) ? competingResult[0] : competingResult;

            console.log(`Found ${competitors.length} competitors for transaction ${transaction.transaction_id}`);

            // Add waiver details to transaction
            transaction.waiver_round = waiverDetails.waiver_round;
            transaction.waiver_order_position = waiverDetails.waiver_order_position;
          }
        }

        // Format the transaction data for frontend compatibility
        return {
          transaction_id: transaction.transaction_id,
          fantasy_team_id: transaction.fantasy_team_id,
          week: transaction.week,
          transaction_date: transaction.transaction_date,
          team_name: transaction.team_name,
          first_name: transaction.first_name,
          last_name: transaction.last_name,
          transaction_type: transaction.transaction_type,
          waiver_round: transaction.waiver_round || null,
          waiver_order_position: transaction.waiver_order_position || null,
          // For frontend compatibility, split acquired/lost back into individual fields
          pickup_name: transaction.acquired_players ? transaction.acquired_players.split(',')[0].replace(/ \([^)]*\)/, '') : '',
          pickup_position: transaction.acquired_players ? transaction.acquired_players.match(/\(([^)]*)\)/)?.[1] || '' : '',
          drop_name: transaction.lost_players ? transaction.lost_players.split(',')[0].replace(/ \([^)]*\)/, '') : '',
          drop_position: transaction.lost_players ? transaction.lost_players.match(/\(([^)]*)\)/)?.[1] || '' : '',
          acquired_players: transaction.acquired_players || '',
          lost_players: transaction.lost_players || '',
          competitors: competitors || []
        };
      })
    );

    // Sort transactions by week (desc), then waiver round (asc), then position (asc)
    transactionsWithCompetitors.sort((a, b) => {
      // Extract week numbers for sorting
      const weekA = parseInt(a.week?.replace(/\D/g, '') || '0');
      const weekB = parseInt(b.week?.replace(/\D/g, '') || '0');

      // Sort by week descending (newest first)
      if (weekA !== weekB) return weekB - weekA;

      // For same week, sort by waiver round (1st before 2nd)
      const roundOrder = { '1st': 1, '2nd': 2 };
      const roundA = roundOrder[a.waiver_round] || 999;
      const roundB = roundOrder[b.waiver_round] || 999;

      if (roundA !== roundB) return roundA - roundB;

      // For same round, sort by waiver position (1 before 2)
      const posA = a.waiver_order_position || 999;
      const posB = b.waiver_order_position || 999;

      if (posA !== posB) return posA - posB;

      // Finally by transaction_id
      return b.transaction_id - a.transaction_id;
    });

    // Build response
    const response = {
      status: 'success',
      totalItems: total,
      page: page,
      itemsPerPage: itemsPerPage,
      totalPages: Math.ceil(total / itemsPerPage) || 1,
      transactions: transactionsWithCompetitors || []
    };

    res.json(response);
  } catch (error) {
    console.error('Database query error:', error);

    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};

// Export the controller
module.exports = transactionController;