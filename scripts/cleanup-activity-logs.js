#!/usr/bin/env node

/**
 * Cleanup Script: Remove API_ACCESS entries for unread-count from activity logs
 * This removes the existing spam entries caused by notification polling
 */

const db = require('../config/database');

async function cleanupActivityLogs() {
  try {
    console.log('🧹 Starting activity logs cleanup...');
    
    // First, let's see how many entries we have
    const countResult = await db.query(`
      SELECT COUNT(*) as total_count
      FROM activity_logs 
      WHERE action_type = 'API_ACCESS' 
        AND details LIKE '%unread-count%'
    `);
    
    const totalEntries = countResult[0].total_count;
    console.log(`📊 Found ${totalEntries} unread-count API entries to remove`);
    
    if (totalEntries === 0) {
      console.log('✅ No unread-count entries found. Nothing to clean up!');
      return;
    }
    
    // Ask for confirmation in a non-interactive way (just show what we're doing)
    console.log(`🗑️  Removing ${totalEntries} API_ACCESS entries with unread-count...`);
    
    // Remove the entries
    const result = await db.query(`
      DELETE FROM activity_logs 
      WHERE action_type = 'API_ACCESS' 
        AND (
          details LIKE '%unread-count%' 
          OR details LIKE '%server-time%'
        )
    `);
    
    console.log(`✅ Successfully removed ${result.affectedRows} activity log entries`);
    
    // Show remaining count
    const remainingResult = await db.query(`
      SELECT COUNT(*) as remaining_count
      FROM activity_logs 
      WHERE action_type = 'API_ACCESS'
    `);
    
    console.log(`📊 Remaining API_ACCESS entries: ${remainingResult[0].remaining_count}`);
    
    // Show some recent legitimate entries to verify we didn't remove too much
    const recentEntries = await db.query(`
      SELECT action_type, details, created_at
      FROM activity_logs 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    console.log('\n📋 Recent activity log entries after cleanup:');
    recentEntries.forEach((entry, index) => {
      const date = new Date(entry.created_at).toLocaleString();
      console.log(`${index + 1}. [${date}] ${entry.action_type}: ${entry.details}`);
    });
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

// Run the cleanup
async function main() {
  try {
    await cleanupActivityLogs();
    console.log('\n🎉 Activity logs cleanup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Cleanup failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { cleanupActivityLogs };