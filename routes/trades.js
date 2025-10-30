/**
 * Trade Routes
 * Handles all routes related to trade proposals and management
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const tradeController = require('../controllers/tradeController');
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /trades
 * @desc    Get user's trades
 * @access  Private
 */
router.get('/', ensureAuthenticated, tradeController.getUserTrades);

/**
 * @route   POST /trades/propose
 * @desc    Submit a trade proposal
 * @access  Private
 */
router.post('/propose', ensureAuthenticated, [
  check('target_team_id', 'Target team is required').isInt(),
  check('trade_items', 'Trade items are required').isArray({ min: 1 })
], tradeController.proposeTrade);

/**
 * @route   GET /trades/admin
 * @desc    Get pending trades for admin approval
 * @access  Private (Admin only)
 */
router.get('/admin', ensureAuthenticated, tradeController.getAdminPendingTrades);

/**
 * @route   POST /trades/admin/:id/approve
 * @desc    Approve a trade proposal
 * @access  Private (Admin only)
 */
router.post('/admin/:id/approve', ensureAuthenticated, tradeController.approveTrade);

/**
 * @route   POST /trades/admin/:id/reject
 * @desc    Reject a trade proposal (admin)
 * @access  Private (Admin only)
 */
router.post('/admin/:id/reject', ensureAuthenticated, tradeController.adminRejectTrade);

/**
 * @route   POST /trades/:id/accept
 * @desc    Accept a trade proposal (team response)
 * @access  Private
 */
router.post('/:id/accept', ensureAuthenticated, tradeController.acceptTrade);

/**
 * @route   POST /trades/:id/reject
 * @desc    Reject a trade proposal (team response)
 * @access  Private
 */
router.post('/:id/reject', ensureAuthenticated, tradeController.rejectTrade);

module.exports = router;