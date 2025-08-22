const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { ensureAuthenticated } = require('../middleware/auth');
const messageBoardController = require('../controllers/messageBoardController');

// Web Routes

/**
 * @route   GET /message-board
 * @desc    Show message board main page with chat room list
 * @access  Private
 */
router.get('/', ensureAuthenticated, messageBoardController.getMessageBoard);

/**
 * @route   GET /message-board/create
 * @desc    Show create new discussion form
 * @access  Private
 */
router.get('/create', ensureAuthenticated, messageBoardController.getCreateForm);

/**
 * @route   GET /message-board/chat/:roomId
 * @desc    Show specific chat room
 * @access  Private
 */
router.get('/chat/:roomId', ensureAuthenticated, messageBoardController.getChatRoom);

// API Routes

/**
 * @route   POST /message-board/api/create
 * @desc    Create new topic with chat room
 * @access  Private
 */
router.post('/api/create', 
  ensureAuthenticated,
  [
    body('title').isLength({ min: 1, max: 100 }).withMessage('Title is required (max 100 characters)'),
    body('content').isLength({ min: 1, max: 5000 }).withMessage('Content is required (max 5000 characters)'),
    body('postType').isIn(['Discussion', 'Poll']).withMessage('Invalid post type')
  ],
  messageBoardController.createTopicWithChat
);

/**
 * @route   GET /message-board/api/chat/:roomId/messages
 * @desc    Get messages for a specific chat room
 * @access  Private
 */
router.get('/api/chat/:roomId/messages', ensureAuthenticated, messageBoardController.getChatMessages);

/**
 * @route   POST /message-board/api/chat/:roomId/message
 * @desc    Send a message to a chat room
 * @access  Private
 */
router.post('/api/chat/:roomId/message',
  ensureAuthenticated,
  [
    body('message').isLength({ min: 1, max: 500 }).withMessage('Message is required (max 500 characters)')
  ],
  messageBoardController.sendChatMessage
);

/**
 * @route   DELETE /message-board/api/chat/:roomId
 * @desc    Delete a chat room (soft delete)
 * @access  Private
 */
router.delete('/api/chat/:roomId', ensureAuthenticated, messageBoardController.deleteChatRoom);

/**
 * @route   POST /message-board/api/poll/:topicId/vote
 * @desc    Vote on a poll
 * @access  Private
 */
router.post('/api/poll/:topicId/vote', ensureAuthenticated, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { optionId } = req.body;
    const userId = req.session.user.id;
    
    const db = require('../config/database');
    
    // Check if user has already voted
    const existingVote = await db.query(
      'SELECT pv.* FROM poll_votes pv JOIN poll_options po ON pv.option_id = po.option_id WHERE po.topic_id = ? AND pv.user_id = ?',
      [topicId, userId]
    );
    
    if (existingVote.length > 0) {
      return res.status(400).json({ success: false, message: 'You have already voted in this poll' });
    }
    
    // Add vote
    await db.query(
      'INSERT INTO poll_votes (option_id, user_id) VALUES (?, ?)',
      [optionId, userId]
    );
    
    // Get updated vote counts
    const options = await db.query(
      'SELECT po.*, (SELECT COUNT(*) FROM poll_votes WHERE option_id = po.option_id) as vote_count FROM poll_options po WHERE topic_id = ? ORDER BY display_order',
      [topicId]
    );
    
    res.json({ 
      success: true, 
      message: 'Vote recorded successfully',
      options: options
    });
    
  } catch (error) {
    console.error('Error voting on poll:', error.message);
    res.status(500).json({ success: false, message: 'Error recording vote' });
  }
});

module.exports = router;