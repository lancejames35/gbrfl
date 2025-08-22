/**
 * Authentication Controller
 * Handles user registration, login, and authentication
 */

const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/user');
const db = require('../config/database');
require('dotenv').config();

/**
 * Register a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.register = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, firstName, lastName } = req.body;

    // Check if username already exists
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    // Check if email already exists
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create user
    const userId = await User.create({
      username,
      email,
      password,
      firstName,
      lastName
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: userId, username: username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Return success with token
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        username,
        email,
        firstName: firstName || '',
        lastName: lastName || ''
      }
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

/**
 * Login a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.login = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // Find user by username
    console.log(`Login attempt for username: ${username}`);
    const user = await User.findByUsername(username);
    if (!user) {
      console.log(`User not found: ${username}`);
      // Log failed login attempt
      await db.query(
        'INSERT INTO login_history (user_id, login_status, ip_address, user_agent) VALUES (?, ?, ?, ?)',
        [null, 'Failed', req.ip || '', req.get('User-Agent') || '']
      );
      
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log(`User found: ${user.username} (ID: ${user.user_id})`);
    console.log(`Password hash length: ${user.password_hash ? user.password_hash.length : 'null'}`);
    
    // Check password
    const isMatch = await User.comparePassword(password, user.password_hash);
    console.log(`Password match result: ${isMatch}`);
    if (!isMatch) {
      console.log(`Password mismatch for user: ${username}`);
      // Log failed login attempt
      await db.query(
        'INSERT INTO login_history (user_id, login_status, ip_address, user_agent) VALUES (?, ?, ?, ?)',
        [user.user_id, 'Failed', req.ip || '', req.get('User-Agent') || '']
      );
      
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login timestamp
    await User.updateLastLogin(user.user_id, req.ip || '', req.get('User-Agent') || '');

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.user_id, username: user.username, isAdmin: user.is_admin === 1 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Set user in session
    req.session.user = {
      id: user.user_id,
      username: user.username,
      isAdmin: user.is_admin === 1
    };

    // Return success with token and user info
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        isAdmin: user.is_admin === 1
      }
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Server error during login' });
  }
};

/**
 * Get current user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getProfile = async (req, res) => {
  try {
    // User is available from the auth middleware
    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        isAdmin: user.is_admin === 1,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Profile error:', error.message);
    res.status(500).json({ message: 'Server error retrieving profile' });
  }
};

/**
 * Logout user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.logout = (req, res) => {
  // Clear the session
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err.message);
      return res.status(500).json({ message: 'Error logging out' });
    }
    
    res.json({ message: 'Logged out successfully' });
  });
};

/**
 * Update user profile (name)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }

    // Update user in database
    const User = require('../models/user');
    const success = await User.update(userId, {
      firstName: firstName.trim(),
      lastName: lastName.trim()
    });

    if (success) {
      // Update session data
      if (req.session.user) {
        req.session.user.firstName = firstName.trim();
        req.session.user.lastName = lastName.trim();
      }

      res.json({ success: true, message: 'Profile updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update profile' });
    }
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ error: 'Server error updating profile' });
  }
};