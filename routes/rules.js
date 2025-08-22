const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /rules
 * @desc    Show league rules and scoring page
 * @access  Private
 */
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('rules', {
    title: 'Rules & Scoring | GBRFL',
    activePage: 'rules'
  });
});

module.exports = router;