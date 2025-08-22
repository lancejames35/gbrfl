const bcrypt = require('bcrypt');

// User data with correct passwords
const users = [
  { user_id: 6, username: 'Hon808', email: 'birdmanyardservice@yahoo.com', password: 'Hon808' },
  { user_id: 4, username: 'DB', email: 'dkb222@yahoo.com', password: '12th8E' },
  { user_id: 9, username: 'Travistotle', email: 'travisjcooper@yahoo.com', password: 'coopdawgphil' },
  { user_id: 3, username: 'IbdFunk', email: 'dfeder07@gmail.com', password: 'bandit' },
  { user_id: 5, username: 'Art Vandalay', email: 'bongosoul@gmail.com', password: '77po3H' },
  { user_id: 10, username: 'Drew Rosenhaus', email: 'hahn4all@gmail.com', password: '69ye9I' },
  { user_id: 8, username: 'DirkDiggler', email: 'nathanh305@gmail.com', password: 'SoIll9' },
  { user_id: 7, username: 'PrimeTime', email: 'gnestro@gmail.com', password: '34d96E' },
  { user_id: 2, username: 'Stegfucius', email: 'stegeman@hawaii.edu', password: '51sx0O' }
];

async function generateCompatibleHashes() {
  console.log('-- SQL statements with $2a$ format hashes (compatible with your system)');
  console.log('-- Copy and paste each statement individually into MySQL\n');

  for (const user of users) {
    try {
      // Generate hash using same format as your existing system
      const hashedPassword = await bcrypt.hash(user.password, 10);
      
      // Force $2a$ format by replacing $2b$ if it appears
      const compatibleHash = hashedPassword.replace('$2b$', '$2a$');
      
      console.log(`-- User: ${user.username} (Password: ${user.password})`);
      console.log(`UPDATE users SET email = '${user.email}', password_hash = '${compatibleHash}' WHERE user_id = ${user.user_id};`);
      console.log('');
      
    } catch (error) {
      console.error(`Error hashing password for user ${user.user_id}:`, error);
    }
  }
  
  console.log('-- After running all updates, verify with:');
  console.log('-- SELECT user_id, username, email, LEFT(password_hash, 20) FROM users WHERE user_id IN (2,3,4,5,6,7,8,9,10);');
}

// Also generate a test script
async function generateTestScript() {
  console.log('\n\n-- Test verification script (save as test_passwords.js):');
  console.log('/*');
  console.log('const bcrypt = require("bcrypt");');
  console.log('');
  
  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    const compatibleHash = hashedPassword.replace('$2b$', '$2a$');
    
    console.log(`// Test ${user.username}`);
    console.log(`bcrypt.compare('${user.password}', '${compatibleHash}').then(result => {`);
    console.log(`  console.log('${user.username} (${user.password}):', result);`);
    console.log('});');
    console.log('');
  }
  
  console.log('*/');
}

// Run both functions
generateCompatibleHashes()
  .then(() => generateTestScript())
  .catch(console.error);