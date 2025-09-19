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
 * Fetches approved waiver transactions with competing requests
 */
transactionController.getTransactions = async (req, res) => {
  try {
    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 50;
    const season = req.query.season || 2025;
    const week = req.query.week || null;
    const owner = req.query.owner || null;
    const type = req.query.type || null;

    // Calculate offset for pagination
    const offset = (page - 1) * itemsPerPage;

    // Base query for approved waiver transactions
    let query = `
      SELECT
        wr.request_id,
        wr.fantasy_team_id,
        wr.week,
        wr.waiver_round,
        wr.waiver_order_position,
        wr.processed_at as transaction_date,
        ft.team_name,
        u.first_name,
        u.last_name,
        pickup.display_name as pickup_name,
        pickup.position as pickup_position,
        drop_player.display_name as drop_name,
        drop_player.position as drop_position,
        pickup.player_id as pickup_player_id
      FROM waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      JOIN nfl_players pickup ON wr.pickup_player_id = pickup.player_id
      JOIN nfl_players drop_player ON wr.drop_player_id = drop_player.player_id
      WHERE wr.status = 'approved'
    `;

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM waiver_requests wr
      JOIN fantasy_teams ft ON wr.fantasy_team_id = ft.team_id
      JOIN users u ON ft.user_id = u.user_id
      WHERE wr.status = 'approved'
    `;

    // Build additional where conditions
    const whereConditions = [];
    const queryParams = [];

    // Always filter by season (default to 2025)
    if (season && season !== 'all') {
      // We need to add season filtering logic - but first we need a season field
      // For now, since all our data is 2025, skip this
    }

    if (week && week !== 'all') {
      whereConditions.push('wr.week = ?');
      queryParams.push(week);
    }

    if (owner && owner !== 'all') {
      whereConditions.push('u.user_id = ?');
      queryParams.push(owner);
    }

    if (type && type !== 'all') {
      // Map type filter to our data structure
      if (type === 'waiver') {
        // All our current data is waiver wire, so no additional filter needed
      } else if (type === 'trade') {
        // When we have trade data, we'll add a filter here
        whereConditions.push('1 = 0'); // For now, no trades exist
      }
    }

    // Execute count query
    let countQueryFinal = countQuery;
    if (whereConditions.length > 0) {
      countQueryFinal = countQueryFinal.replace('WHERE wr.status = \'approved\'',
        `WHERE wr.status = 'approved' AND ${whereConditions.join(' AND ')}`);
    }

    console.log('Count query:', countQueryFinal);
    const [countResult] = await db.query(countQueryFinal, queryParams);
    const total = countResult[0]?.total || 0;

    // Build the final query with filters
    let finalQuery = query;

    console.log('Query params:', queryParams);
    console.log('Additional conditions:', whereConditions);

    // Apply filtering dynamically
    if (whereConditions.length > 0) {
      finalQuery = finalQuery.replace('WHERE wr.status = \'approved\'',
        `WHERE wr.status = 'approved' AND ${whereConditions.join(' AND ')}`);
    }

    // Add ordering and pagination
    finalQuery += `
      ORDER BY
        wr.week DESC,
        wr.processed_at DESC,
        wr.request_id ASC
      LIMIT ${parseInt(itemsPerPage)} OFFSET ${parseInt(offset)}
    `;

    console.log('Final query with filters:', finalQuery);
    console.log('Final params for query:', queryParams);

    const result = await db.query(finalQuery, queryParams);
    const approvedTransactions = Array.isArray(result[0]) ? result[0] : result;

    if (!Array.isArray(approvedTransactions)) {
      throw new Error('Query did not return an array');
    }

    console.log(`Processing ${approvedTransactions.length} approved transactions for competitors`);

    // For each approved transaction, get competing requests
    const transactionsWithCompetitors = await Promise.all(
      approvedTransactions.map(async (transaction) => {
        console.log(`Checking competitors for transaction ${transaction.request_id}, player ${transaction.pickup_name} (ID: ${transaction.pickup_player_id})`);

        // Get all requests for the same pickup player in the same week and round
        // Exclude auto-rejections for dropped players AND same team that won
        const competingQuery = `
          SELECT
            wr.request_id,
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
            AND wr.waiver_round = ?
            AND wr.request_id != ?
            AND wr.fantasy_team_id != ?
            AND wr.status = 'rejected'
            AND (wr.notes IS NULL OR wr.notes LIKE '%Auto-rejected: Player acquired by another team%')
          ORDER BY wr.waiver_order_position ASC
        `;

        const competingParams = [
          transaction.pickup_player_id,
          transaction.week,
          transaction.week,
          transaction.waiver_round,
          transaction.request_id,
          transaction.fantasy_team_id
        ];

        console.log('Competing query params:', competingParams);

        const competingResult = await db.query(competingQuery, competingParams);
        const competitors = Array.isArray(competingResult[0]) ? competingResult[0] : competingResult;

        console.log(`Found ${competitors.length} competitors for transaction ${transaction.request_id}`);

        if (competitors.length > 0) {
          console.log('Competitors:', competitors.map(c => `${c.team_name} (waiver pos: ${c.waiver_order_position})`));
        }

        return {
          ...transaction,
          competitors: competitors || []
        };
      })
    );

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