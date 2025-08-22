const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * @route   GET /champions
 * @desc    Show league champions page
 * @access  Private
 */
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('champions', {
    title: 'Champions | GBRFL',
    activePage: 'champions'
  });
});

module.exports = router;