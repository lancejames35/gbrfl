// Database connection test script
require('dotenv').config();
const db = require('../config/database');

async function testDatabaseConnection() {
  try {
    console.log('Attempting to connect to the database...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    
    // Test the connection
    const connected = await db.testConnection();
    
    if (connected) {
      console.log('\nDatabase configuration is correct and connection is working properly.');
      
      // Check database tables
      const tables = await db.query('SHOW TABLES');
      console.log('\nAvailable tables:');
      if (tables.length === 0) {
        console.log('No tables found in the database.');
      } else {
        tables.forEach(table => {
          const tableName = table[`Tables_in_${process.env.DB_NAME}`];
          console.log(`- ${tableName}`);
        });
      }
    } else {
      console.error('\nConnection test failed. Please check your database configuration.');
    }
  } catch (error) {
    console.error('❌ Error during database test:', error.message);
  } finally {
    process.exit(); // Exit the script
  }
}

// Run the test
testDatabaseConnection();