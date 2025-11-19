/**
 * Authentication Routes
 * Handles user registration, login, and authentication endpoints
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate, authenticateHybrid } = require('../middleware/auth');

/**
 * @route   POST api/auth/register
 * @desc    Register a new user (DISABLED)
 * @access  Public
 */
router.post('/register', (req, res) => {
  return res.status(403).json({
    message: 'Registration is currently closed. Please contact an administrator to create an account.'
  });
});

/**
 * @route   POST api/auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
router.post(
  '/login',
  [
    check('username', 'Username is required').not().isEmpty(),
    check('password', 'Password is required').exists()
  ],
  authController.login
);

/**
 * @route   GET api/auth/profile
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile', authenticate, authController.getProfile);

/**
 * @route   POST api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @route   PUT api/auth/update-profile
 * @desc    Update user profile (name)
 * @access  Private
 */
router.put('/update-profile', authenticateHybrid, authController.updateProfile);

module.exports = router;