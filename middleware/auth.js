/**
 * Authentication Middleware
 * Handles JWT verification and user authorization
 */

const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('../config/database');

// Routes that should not be logged in activity logs to reduce noise
const EXCLUDED_ROUTES = [
  '/api/notifications/unread-count',
  '/api/server-time'
];

/**
 * Middleware to authenticate JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists
    const users = await db.query('SELECT * FROM users WHERE user_id = ?', [decoded.userId]);
    
    if (users.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Add user to request object
    req.user = users[0];
    req.userId = decoded.userId;
    
    // Log user activity (skip excluded routes to reduce noise)
    if (!EXCLUDED_ROUTES.includes(req.originalUrl)) {
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'API_ACCESS', 'ROUTE', null, `Accessed route: ${req.originalUrl}`]
      );
    }
    
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

/**
 * Middleware to check if user is admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const isAdmin = (req, res, next) => {
  // Use req.user (which may have been set by JWT or from the session)
  const user = req.user || req.session.user;
  
  // If neither exists or if the admin flag is not set to 1, deny access.
  // This checks either the "is_admin" field or the "isAdmin" boolean.
  if (!user || Number(user.is_admin || user.isAdmin) !== 1) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  
  next();
};

/**
 * Middleware to ensure user is authenticated for web routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const ensureAuthenticated = (req, res, next) => {
  console.log('=== DEBUG SESSION ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', JSON.stringify(req.session, null, 2));
  console.log('Session user:', req.session.user);
  console.log('=== END DEBUG ===');
  
  if (req.session.user) {
    // Set req.user for later middleware to use
    req.user = req.session.user;
    return next();
  }
  
  // Store the requested URL to redirect after login
  req.session.returnTo = req.originalUrl;
  
  // Flash a message
  req.flash('error_msg', 'Please log in to access this page');
  
  // Redirect to login page
  res.redirect('/login');
};

/**
 * Middleware to authenticate using either JWT tokens or session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateHybrid = async (req, res, next) => {
  try {
    // First try JWT authentication
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      // Use JWT authentication
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const users = await db.query('SELECT * FROM users WHERE user_id = ?', [decoded.userId]);
        
        if (users.length > 0) {
          req.user = users[0];
          req.userId = decoded.userId;
          
          // Log user activity only if userId is valid (skip excluded routes to reduce noise)
          if (req.userId && !EXCLUDED_ROUTES.includes(req.originalUrl)) {
            await db.query(
              'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
              [req.userId, 'API_ACCESS', 'ROUTE', null, `Accessed route: ${req.originalUrl}`]
            );
          }
          
          return next();
        }
      } catch (jwtError) {
        console.error('JWT authentication failed:', jwtError.message);
        // Fall through to session authentication
      }
    }
    
    // Try session authentication
    if (req.session && req.session.user) {
      req.user = req.session.user;
      req.userId = req.session.user.id;
      
      // Log user activity only if userId is valid (skip excluded routes to reduce noise)
      if (req.userId && !EXCLUDED_ROUTES.includes(req.originalUrl)) {
        await db.query(
          'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [req.userId, 'API_ACCESS', 'ROUTE', null, `Accessed route: ${req.originalUrl}`]
        );
      }
      
      return next();
    }
    
    // Neither authentication method worked
    return res.status(401).json({ message: 'Authentication required' });
    
  } catch (error) {
    console.error('Authentication error:', error.message);
    return res.status(401).json({ message: 'Authentication failed' });
  }
};

module.exports = { authenticate, isAdmin, ensureAuthenticated, authenticateHybrid };