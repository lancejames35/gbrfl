const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

// Import controller (we'll create this next)
const draftController = require('../controllers/draftController');

// Draft room route
router.get('/', ensureAuthenticated, draftController.getDraftRoom);

// API routes for real-time functionality
router.get('/api/players', ensureAuthenticated, draftController.getAvailablePlayers);
router.get('/api/queue', ensureAuthenticated, draftController.getQueue);
router.get('/api/draft-order', ensureAuthenticated, draftController.getDraftOrder);
router.post('/api/queue/add', ensureAuthenticated, draftController.addToQueue);
router.post('/api/queue/remove', ensureAuthenticated, draftController.removeFromQueue);
router.post('/api/queue/reorder', ensureAuthenticated, draftController.reorderQueue);
router.post('/api/pick', ensureAuthenticated, draftController.makePick);
router.get('/api/draft-board', ensureAuthenticated, draftController.getDraftBoard);
router.get('/api/team-roster', ensureAuthenticated, draftController.getTeamRoster);
router.get('/api/chat-messages', ensureAuthenticated, draftController.getChatMessages);
router.post('/api/chat-message', ensureAuthenticated, draftController.sendChatMessage);

// Admin routes
router.post('/api/admin/start', ensureAuthenticated, draftController.startDraft);
router.post('/api/admin/stop', ensureAuthenticated, draftController.stopDraft);

module.exports = router;