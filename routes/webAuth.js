/**
 * Web Authentication Routes
 * Handles web-based login, registration, and authentication pages
 */

const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');

const User = require('../models/user');
const bcrypt = require('bcryptjs');
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /login
 * @desc    Show login page
 * @access  Public
 */
router.get('/login', (req, res) => {
  // If user is already logged in, redirect to dashboard
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  
  res.render('auth/login', {
    title: 'Login',
    layout: 'layouts/auth-layout', // Add this line
    returnTo: req.session.returnTo || ''
  });
});

/**
 * @route   POST /login
 * @desc    Process login
 * @access  Public
 */
router.post('/login', [
  check('username', 'Username is required').not().isEmpty(),
  check('password', 'Password is required').not().isEmpty()
], async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check for validation errors
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return res.render('auth/login', {
        title: 'Login',
        layout: 'layouts/auth-layout',
        errors: validationErrors.array(),
        username
      });
    }
    
    // Find user
    const user = await User.findByUsername(username);
    
    if (!user) {
      return res.render('auth/login', {
        title: 'Login',
        layout: 'layouts/auth-layout',
        errors: [{ msg: 'Invalid username or password' }],
        username
      });
    }
    
    // Check if user account is active (if is_active field exists)
    if (user.is_active !== undefined && !user.is_active) {
      return res.render('auth/login', {
        title: 'Login',
        layout: 'layouts/auth-layout',
        errors: [{ msg: 'Account is disabled. Please contact an administrator.' }],
        username
      });
    }
    
    // Check password
    const isMatch = await User.comparePassword(password, user.password_hash);
    if (!isMatch) {
      return res.render('auth/login', {
        title: 'Login',
        layout: 'layouts/auth-layout',
        errors: [{ msg: 'Invalid username or password' }],
        username
      });
    }
    
    // Update last login
    await User.updateLastLogin(user.user_id, req.ip || '', req.get('User-Agent') || '');
    
    // Set user in session
    req.session.user = {
      id: user.user_id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      isAdmin: user.is_admin === 1
    };
    
    console.log('Setting session user:', req.session.user);
    console.log('Session ID before save:', req.sessionID);
    
    // Success message
    req.flash('success_msg', 'You are now logged in');
    
    // Redirect to intended page or dashboard
    const returnTo = req.body.returnTo || req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    
    // Explicitly save session before redirect
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        req.flash('error_msg', 'An error occurred during login');
        return res.redirect('/login');
      }
      console.log('Session saved successfully, redirecting to:', returnTo);
      res.redirect(returnTo);
    });
  } catch (error) {
    console.error('Login error:', error);
    req.flash('error_msg', 'An error occurred during login');
    res.redirect('/login');
  }
});

/**
 * @route   GET /register
 * @desc    Show registration page
 * @access  Public
 */
router.get('/register', (req, res) => {
  // If user is already logged in, redirect to dashboard
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  
  res.render('auth/register', {
    title: 'Register',
    layout: 'layouts/auth-layout' // Add this line
  });
});

/**
 * @route   POST /register
 * @desc    Process registration
 * @access  Public
 */
router.post('/register', [
  check('username', 'Username is required').not().isEmpty(),
  check('username', 'Username must be between 3 and 20 characters').isLength({ min: 3, max: 20 }),
  check('email', 'Email is required').not().isEmpty(),
  check('email', 'Please include a valid email').isEmail(),
  check('password', 'Password is required').not().isEmpty(),
  check('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
  check('confirmPassword', 'Confirm password is required').not().isEmpty(),
  check('confirmPassword', 'Passwords do not match').custom((value, { req }) => value === req.body.password)
], async (req, res) => {
  try {
    const { username, email, password, firstName, lastName } = req.body;
    
    // Check for validation errors
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return res.render('auth/register', {
        title: 'Register',
        layout: 'layouts/auth-layout',
        errors: validationErrors.array(),
        username,
        email,
        firstName,
        lastName
      });
    }
    
    // Check if username already exists
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.render('auth/register', {
        title: 'Register',
        layout: 'layouts/auth-layout',
        errors: [{ msg: 'Username already taken' }],
        email,
        firstName,
        lastName
      });
    }
    
    // Check if email already exists
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.render('auth/register', {
        title: 'Register',
        layout: 'layouts/auth-layout',
        errors: [{ msg: 'Email already registered' }],
        username,
        firstName,
        lastName
      });
    }
    
    // Create user
    const userId = await User.create({
      username,
      email,
      password,
      firstName,
      lastName
    });
    
    // Success message
    req.flash('success_msg', 'You are now registered and can log in');
    res.redirect('/login');
  } catch (error) {
    console.error('Registration error:', error);
    req.flash('error_msg', 'An error occurred during registration');
    res.redirect('/register');
  }
});

/**
 * @route   GET /logout
 * @desc    Logout user
 * @access  Private
 */
router.get('/logout', ensureAuthenticated, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/dashboard');
    }
    res.redirect('/login');
  });
});

/**
 * @route   POST /admin/switch-user
 * @desc    Admin switch to another user
 * @access  Admin only
 */
router.post('/admin/switch-user', ensureAuthenticated, async (req, res) => {
  try {
    // Check if current user is admin
    if (!req.session.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    const { targetUserId } = req.body;
    
    // Find target user
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Store original admin user if not already stored
    if (!req.session.originalAdmin) {
      req.session.originalAdmin = { ...req.session.user };
    }
    
    // Switch to target user
    req.session.user = {
      id: targetUser.user_id,
      username: targetUser.username,
      firstName: targetUser.first_name,
      lastName: targetUser.last_name,
      isAdmin: targetUser.is_admin === 1
    };
    
    res.json({ 
      success: true, 
      message: `Switched to user: ${targetUser.first_name} ${targetUser.last_name}` 
    });
    
  } catch (error) {
    console.error('Switch user error:', error);
    res.status(500).json({ success: false, message: 'Error switching user' });
  }
});

/**
 * @route   POST /admin/switch-back
 * @desc    Switch back to original admin user
 * @access  Private (when impersonating)
 */
router.post('/admin/switch-back', ensureAuthenticated, (req, res) => {
  try {
    if (!req.session.originalAdmin) {
      return res.status(400).json({ success: false, message: 'No original admin to switch back to' });
    }
    
    // Restore original admin user
    req.session.user = { ...req.session.originalAdmin };
    delete req.session.originalAdmin;
    
    res.json({ 
      success: true, 
      message: 'Switched back to admin account' 
    });
    
  } catch (error) {
    console.error('Switch back error:', error);
    res.status(500).json({ success: false, message: 'Error switching back' });
  }
});

module.exports = router;