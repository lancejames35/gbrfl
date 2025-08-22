const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /transactions
 * @desc    Show league transactions page
 * @access  Private
 */
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('transactions', {
    title: 'Transactions | GBRFL',
    activePage: 'transactions'
  });
});

module.exports = router;