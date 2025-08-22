const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /standings
 * @desc    Show league standings page
 * @access  Private
 */
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('standings', {
    title: 'Standings | GBRFL',
    activePage: 'standings'
  });
});

module.exports = router;