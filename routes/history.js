const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /history
 * @desc    Show league history page
 * @access  Private
 */
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('history', {
    title: 'League History | GBRFL',
    activePage: 'history'
  });
});

module.exports = router;