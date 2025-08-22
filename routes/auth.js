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
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/register',
  [
    check('username', 'Username is required').not().isEmpty(),
    check('username', 'Username must be between 3 and 20 characters').isLength({ min: 3, max: 20 }),
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password must be at least 6 characters').isLength({ min: 6 })
  ],
  authController.register
);

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