const bcrypt = require('bcrypt');

const users = [
  { user_id: 6, email: 'birdmanyardservice@yahoo.com', password: 'Hon808' },
  { user_id: 4, email: 'dkb222@yahoo.com', password: '12th8E' },
  { user_id: 9, email: 'travisjcooper@yahoo.com', password: 'coopdawgphil' },
  { user_id: 3, email: 'dfeder07@gmail.com', password: 'bandit' },
  { user_id: 5, email: 'bongosoul@gmail.com', password: '77po3H' },
  { user_id: 10, email: 'hahn4all@gmail.com', password: '69ye9I' },
  { user_id: 8, email: 'nathanh305@gmail.com', password: 'SoIll9' },
  { user_id: 7, email: 'gnestro@gmail.com', password: '34d96E' },
  { user_id: 2, email: 'stegeman@hawaii.edu', password: '51sx0O' }
];

async function generateUpdates() {
  for (const user of users) {
    // Use version 2a to match your system
    const hashedPassword = await bcrypt.hash(user.password, 10);
    console.log(`UPDATE users SET email = '${user.email}', password_hash = '${hashedPassword}' WHERE user_id = ${user.user_id};`);
  }
}

generateUpdates();