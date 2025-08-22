/**
 * User Model
 * Handles all user-related database operations
 */

const db = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  /**
   * Find a user by ID
   * @param {number} userId - The user's ID
   * @returns {Promise<Object|null>} - The user object or null if not found
   */
  static async findById(userId) {
    try {
      const users = await db.query(
        'SELECT user_id, username, email, first_name, last_name, created_at, last_login, is_admin FROM users WHERE user_id = ?',
        [userId]
      );
      return users.length ? users[0] : null;
    } catch (error) {
      console.error('Error finding user by ID:', error.message);
      throw error;
    }
  }

  /**
   * Find a user by username
   * @param {string} username - The username to search for
   * @returns {Promise<Object|null>} - The user object or null if not found
   */
  static async findByUsername(username) {
    try {
      const users = await db.query('SELECT * FROM users WHERE username = ?', [username]);
      return users.length ? users[0] : null;
    } catch (error) {
      console.error('Error finding user by username:', error.message);
      throw error;
    }
  }

  /**
   * Find a user by email
   * @param {string} email - The email to search for
   * @returns {Promise<Object|null>} - The user object or null if not found
   */
  static async findByEmail(email) {
    try {
      const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      return users.length ? users[0] : null;
    } catch (error) {
      console.error('Error finding user by email:', error.message);
      throw error;
    }
  }

  /**
   * Create a new user
   * @param {Object} userData - User data including username, email, password, etc.
   * @returns {Promise<number>} - The ID of the newly created user
   */
  static async create(userData) {
    try {
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);
      
      // Insert user
      const result = await db.query(
        'INSERT INTO users (username, email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?, ?)',
        [
          userData.username,
          userData.email,
          hashedPassword,
          userData.firstName || null,
          userData.lastName || null
        ]
      );
      
      // Log activity
      if (result.insertId) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [result.insertId, 'USER_CREATED', 'USER', result.insertId, 'New user registered']
        );
      }
      
      return result.insertId;
    } catch (error) {
      console.error('Error creating user:', error.message);
      throw error;
    }
  }

  /**
   * Update user information
   * @param {number} userId - The ID of the user to update
   * @param {Object} userData - The data to update
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  static async update(userId, userData) {
    try {
      // Start building the query
      let query = 'UPDATE users SET ';
      const params = [];
      
      // Add fields to update
      if (userData.username) {
        query += 'username = ?, ';
        params.push(userData.username);
      }
      
      if (userData.email) {
        query += 'email = ?, ';
        params.push(userData.email);
      }
      
      if (userData.firstName) {
        query += 'first_name = ?, ';
        params.push(userData.firstName);
      }
      
      if (userData.lastName) {
        query += 'last_name = ?, ';
        params.push(userData.lastName);
      }
      
      // If password is being updated
      if (userData.password) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(userData.password, salt);
        query += 'password_hash = ?, ';
        params.push(hashedPassword);
      }
      
      // Remove trailing comma and space
      query = query.slice(0, -2);
      
      // Add WHERE clause
      query += ' WHERE user_id = ?';
      params.push(userId);
      
      // Execute query
      const result = await db.query(query, params);
      
      // Log activity
      if (result.affectedRows > 0) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [userId, 'USER_UPDATED', 'USER', userId, 'User profile updated']
        );
      }
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating user:', error.message);
      throw error;
    }
  }

  /**
   * Update last login timestamp
   * @param {number} userId - The ID of the user
   * @param {string} ipAddress - The user's IP address
   * @param {string} userAgent - The user's user agent string
   * @returns {Promise<boolean>} - True if successful
   */
  static async updateLastLogin(userId, ipAddress = null, userAgent = null) {
    try {
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?',
        [userId]
      );
      
      // Log login with additional info
      await db.query(
        'INSERT INTO login_history (user_id, login_status, ip_address, user_agent) VALUES (?, ?, ?, ?)',
        [userId, 'Success', ipAddress, userAgent]
      );
      
      return true;
    } catch (error) {
      console.error('Error updating last login:', error.message);
      throw error;
    }
  }

  /**
   * Log failed login attempt
   * @param {string} username - The attempted username
   * @param {string} ipAddress - The user's IP address
   * @param {string} userAgent - The user's user agent string
   * @returns {Promise<boolean>} - True if successful
   */
  static async logFailedLogin(username, ipAddress = null, userAgent = null) {
    try {
      // Try to find the user to get their ID
      const user = await this.findByUsername(username);
      const userId = user ? user.user_id : null;
      
      await db.query(
        'INSERT INTO login_history (user_id, login_status, ip_address, user_agent) VALUES (?, ?, ?, ?)',
        [userId, 'Failed', ipAddress, userAgent]
      );
      
      return true;
    } catch (error) {
      console.error('Error logging failed login:', error.message);
      throw error;
    }
  }

  /**
   * Get all users
   * @returns {Promise<Array>} - Array of user objects
   */
  static async getAll() {
    try {
      const users = await db.query(
        'SELECT user_id, username, email, first_name, last_name, created_at, last_login, is_admin FROM users'
      );
      return users;
    } catch (error) {
      console.error('Error getting users:', error.message);
      throw error;
    }
  }

  /**
   * Get all users with extended information for admin panel
   * @returns {Promise<Array>} - Array of user objects with fantasy team info
   */
  static async getAllWithDetails() {
    try {
      const query = `
        SELECT 
          u.user_id,
          u.username,
          u.email,
          u.first_name,
          u.last_name,
          u.is_admin,
          COALESCE(u.is_active, 1) as is_active,
          u.created_at,
          u.last_login,
          u.last_activity,
          ft.team_id,
          ft.team_name,
          COALESCE(lh.recent_logins, 0) as recent_logins
        FROM users u
        LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as recent_logins
          FROM login_history 
          WHERE login_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND login_status = 'Success'
          GROUP BY user_id
        ) lh ON u.user_id = lh.user_id
        ORDER BY u.created_at DESC
      `;
      
      const users = await db.query(query);
      return users;
    } catch (error) {
      console.error('Error getting users with details:', error.message);
      throw error;
    }
  }

  /**
   * Get user statistics for admin dashboard
   * @returns {Promise<Object>} - Statistics object
   */
  static async getStatistics() {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN last_login >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN is_admin = 1 THEN 1 ELSE 0 END) as admin_users,
          SUM(CASE WHEN last_login >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as recent_active
        FROM users
      `;
      
      const [stats] = await db.query(query);
      return stats || { total_users: 0, active_users: 0, admin_users: 0, recent_active: 0 };
    } catch (error) {
      console.error('Error getting user statistics:', error.message);
      throw error;
    }
  }

  /**
   * Compare password with stored hash
   * @param {string} plainPassword - The plain text password
   * @param {string} hashedPassword - The stored password hash
   * @returns {Promise<boolean>} - True if passwords match
   */
  static async comparePassword(plainPassword, hashedPassword) {
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      console.error('Error comparing passwords:', error.message);
      throw error;
    }
  }

  /**
   * Toggle user active status
   * @param {number} userId - The user's ID
   * @param {boolean} isActive - The new active status
   * @returns {Promise<boolean>} - True if successful
   */
  static async toggleActiveStatus(userId, isActive) {
    try {
      const result = await db.query(
        'UPDATE users SET is_active = ? WHERE user_id = ?',
        [isActive ? 1 : 0, userId]
      );
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error toggling user active status:', error.message);
      throw error;
    }
  }
}

module.exports = User;