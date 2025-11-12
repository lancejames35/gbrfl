/**
 * Waiver Routes
 * Routes for waiver wire request functionality
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { ensureAuthenticated } = require('../middleware/auth');
const waiverController = require('../controllers/waiverController');

/**
 * @route   POST /waivers/request
 * @desc    Submit a waiver wire request
 * @access  Private
 */
router.post('/request', 
  ensureAuthenticated,
  [
    body('pickup_player_id')
      .isInt({ min: 1 })
      .withMessage('Valid pickup player ID is required'),
    body('drop_player_id')
      .isInt({ min: 1 })
      .withMessage('Valid drop player ID is required'),
    body('waiver_round')
      .isIn(['1st', '2nd'])
      .withMessage('Valid waiver round is required')
  ],
  waiverController.submitWaiverRequest
);

/**
 * @route   GET /waivers/pending
 * @desc    View pending waiver requests
 * @access  Private
 */
router.get('/pending', ensureAuthenticated, waiverController.getPendingRequests);

/**
 * @route   GET /waivers/all-requests
 * @desc    View all processed waiver requests (history)
 * @access  Private
 */
router.get('/all-requests', ensureAuthenticated, waiverController.getAllProcessedRequests);

/**
 * @route   PUT /waivers/order
 * @desc    Update waiver request order
 * @access  Private
 */
router.put('/order', ensureAuthenticated, waiverController.updateRequestOrder);

/**
 * @route   DELETE /waivers/request/:id
 * @desc    Cancel a waiver request
 * @access  Private
 */
router.delete('/request/:id', ensureAuthenticated, waiverController.cancelRequest);

/**
 * API routes
 */
router.get('/api/pending/count', ensureAuthenticated, waiverController.getPendingRequestCount);
router.get('/debug', ensureAuthenticated, waiverController.debugWaiverData);

/**
 * Admin routes
 */
router.get('/admin', ensureAuthenticated, waiverController.getAdminPendingRequests);
router.post('/admin/:id/approve', ensureAuthenticated, waiverController.approveRequest);
router.post('/admin/:id/reject', ensureAuthenticated, waiverController.rejectRequest);

module.exports = router;