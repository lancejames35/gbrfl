const express = require('express');
const router = express.Router();
const scoreboardController = require('../controllers/scoreboardController');
const { authenticate, ensureAuthenticated } = require('../middleware/auth');

// Main scoreboard routes (web interface)
router.get('/', ensureAuthenticated, scoreboardController.getScoreboard);
router.get('/enhanced', ensureAuthenticated, (req, res) => {
  // Force enhanced layout
  req.query.layout = 'enhanced';
  scoreboardController.getScoreboard(req, res);
});
router.get('/week/:week', ensureAuthenticated, scoreboardController.getWeeklyScoreboard);
router.get('/week/:week/:type', ensureAuthenticated, scoreboardController.getWeeklyScoreboard);
router.get('/game/:gameId', ensureAuthenticated, scoreboardController.getGameDetail);

// AJAX endpoints for live updates (API endpoints)
router.get('/api/live/:gameId', authenticate, scoreboardController.getLiveUpdates);

module.exports = router;