const mysql = require('mysql2/promise');
require('dotenv').config();

// Parse DATABASE_URL if provided (Railway format)
let dbConfig;

if (process.env.DATABASE_URL) {
  // Parse Railway's DATABASE_URL format: mysql://user:password@host:port/database
  const url = new URL(process.env.DATABASE_URL);
  
  dbConfig = {
    host: url.hostname,
    port: url.port || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading slash
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };
} else {
  // Use individual environment variables (for local development)
  dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };
}

// Create connection pool with error handling
let pool;

try {
  pool = mysql.createPool(dbConfig);
  
  console.log('MySQL connection pool initialized');
  console.log(`Connecting to: ${dbConfig.host}:${dbConfig.port || 3306}`);
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