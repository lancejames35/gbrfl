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
    const [users] = await db.query(`
      SELECT user_id, first_name, last_name 
      FROM users 
      ORDER BY first_name, last_name
    `);
    
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
 * Fetches transactions with filtering options
 */
transactionController.getTransactions = async (req, res) => {
  try {
    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 20;
    const season = req.query.season || null;
    const week = req.query.week || null;
    const owner = req.query.owner || null;
    const type = req.query.type || null;
    
    // Calculate offset for pagination
    const offset = (page - 1) * itemsPerPage;
    
    // Base query for historical transactions
    let query = `
      SELECT 
        transaction_id, 
        season_year, 
        week, 
        transaction_date, 
        owner_name, 
        transaction_type, 
        acquired, 
        lost, 
        is_conditional, 
        notes, 
        related_transaction_id
      FROM historical_transactions
    `;
    
    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM historical_transactions
    `;
    
    // Build where clause
    const whereConditions = [];
    const queryParams = [];
    
    if (season && season !== 'all') {
      whereConditions.push('season_year = ?');
      queryParams.push(season);
    }
    
    if (week && week !== 'all') {
      whereConditions.push('week = ?');
      queryParams.push(week);
    }
    
    if (owner && owner !== 'all') {
      // Join with fantasy_teams to get owner by user_id
      query = `
        SELECT 
          ht.transaction_id, 
          ht.season_year, 
          ht.week, 
          ht.transaction_date, 
          ht.owner_name, 
          ht.transaction_type, 
          ht.acquired, 
          ht.lost, 
          ht.is_conditional, 
          ht.notes, 
          ht.related_transaction_id
        FROM historical_transactions ht
        JOIN fantasy_teams ft ON ht.owner_name = ft.team_name
        JOIN users u ON ft.user_id = u.user_id
      `;
      
      countQuery = `
        SELECT COUNT(*) as total 
        FROM historical_transactions ht
        JOIN fantasy_teams ft ON ht.owner_name = ft.team_name
        JOIN users u ON ft.user_id = u.user_id
      `;
      
      whereConditions.push('u.user_id = ?');
      queryParams.push(owner);
    }
    
    if (type && type !== 'all') {
      whereConditions.push('transaction_type = ?');
      queryParams.push(type);
    }
    
    // Append where clause to queries if conditions exist
    if (whereConditions.length > 0) {
      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      query += ` ${whereClause}`;
      countQuery += ` ${whereClause}`;
    }
    
    // Order by section of the query
    const orderBy = `
      ORDER BY 
        season_year DESC, 
        CASE 
          WHEN week = 'Offseason' THEN 1
          WHEN week = 'Draft' THEN 2
          ELSE 3
        END ASC,
        CASE 
          WHEN week NOT IN ('Offseason', 'Draft') THEN CAST(SUBSTRING(week, 6) AS UNSIGNED)
          ELSE 0
        END DESC,
        transaction_date DESC,
        IFNULL(related_transaction_id, transaction_id) DESC,
        transaction_id ASC
    `;
    
    // Add the ORDER BY clause to the main query
    query += orderBy;
    
    // Execute the count query to get total number of records
    console.log('Count Query:', countQuery);
    console.log('Count Params:', queryParams);
    
    let total = 0;
    try {
      const [countResult] = await db.query(countQuery, queryParams);
      console.log('Count Result:', countResult);
      
      // Check if we have results and they have the expected structure
      if (countResult && countResult.length > 0 && 'total' in countResult[0]) {
        total = parseInt(countResult[0].total);
      } else {
        console.error('Count query returned unexpected structure:', countResult);
        // Fallback - just count the actual results
        total = 0;
      }
    } catch (countError) {
      console.error('Error executing count query:', countError);
      // Continue execution with total = 0
    }
    
    // Add the LIMIT clause to the main query
    query += ' LIMIT ? OFFSET ?';
    
    // Add pagination parameters
    const finalParams = [...queryParams, itemsPerPage, offset];
    
    console.log('Main Query:', query);
    console.log('Final Params:', finalParams);
    
    // Execute the main query with all parameters
    const [transactions] = await db.query(query, finalParams);
    
    // If count query failed but we have transactions, use their count as total
    if (total === 0 && transactions && transactions.length > 0) {
      total = transactions.length;
    }
    
    // Build response
    const response = {
      status: 'success',
      totalItems: total,
      page: page,
      itemsPerPage: itemsPerPage,
      totalPages: Math.ceil(total / itemsPerPage) || 1, // Ensure at least 1 page
      transactions: transactions || []
    };
    
    res.json(response);
  } catch (error) {
    console.error('Database query error:', error);
    console.error('Query:', error.sql || 'Query not available');
    console.error('Parameters:', error.parameters || 'No parameters available');
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};

// Export the controller
module.exports = transactionController;