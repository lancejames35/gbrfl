const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const transactionController = require('../controllers/transactionController');

/**
 * @route   GET /transactions
 * @desc    Show league transactions page
 * @access  Private
 */
router.get('/', ensureAuthenticated, transactionController.getTransactionsPage);

module.exports = router;