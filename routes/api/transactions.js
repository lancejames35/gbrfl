/**
 * API Routes for Transactions
 */

const express = require('express');
const router = express.Router();
const transactionController = require('../../controllers/transactionController');
const { ensureAuthenticated } = require('../../middleware/auth');

// Get transactions with filter options
// GET /api/transactions
router.get('/', ensureAuthenticated, transactionController.getTransactions);

module.exports = router;