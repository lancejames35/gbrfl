const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool with error handling
let pool;

try {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  
  console.log('MySQL connection pool initialized');
} catch (error) {
  console.error('Error creating MySQL connection pool:', error.message);
  process.exit(1); // Exit with failure
}

// Testing function to check database connection
const testConnection = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('✅ Database connection established successfully');
    
    // Test query to ensure database is working
    const [rows] = await connection.query('SELECT 1 + 1 AS result');
    console.log(`Database query test: 1 + 1 = ${rows[0].result}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error connecting to the database:', error.message);
    return false;
  } finally {
    if (connection) connection.release();
  }
};

// Helper function to execute queries with proper error handling
const query = async (sql, params) => {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error.message);
    console.error('Query:', sql);
    console.error('Parameters:', params);
    throw error; // Re-throw for handling by the caller
  }
};

// Export the connection pool and helper functions
module.exports = {
  pool,
  testConnection,
  query
};