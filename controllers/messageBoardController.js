/**
 * Message Board Controller
 * Handles message board and chat room functionality
 */

const Chat = require('../models/chat');
const { validationResult } = require('express-validator');

/**
 * Get the main message board page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getMessageBoard = async (req, res) => {
  try {
    // Get all chat rooms for the message board
    const chatRooms = await Chat.getAllChatRooms();
    
    res.render('messageBoard/index', {
      title: 'Message Board',
      chatRooms,
      activePage: 'message-board'
    });
    
  } catch (error) {
    console.error('Error loading message board:', error.message);
    req.flash('error_msg', 'Error loading message board');
    res.redirect('/dashboard');
  }
};

/**
 * Get a specific chat room
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getChatRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Get chat room details
    const chatRoom = await Chat.getChatRoomById(roomId);
    if (!chatRoom) {
      req.flash('error_msg', 'Chat room not found');
      return res.redirect('/message-board');
    }
    
    // Get recent messages
    const messages = await Chat.getRoomMessages(roomId, 50);
    
    // If it's a poll, get poll options and votes
    let pollData = null;
    if (chatRoom.topic_type === 'Poll' && chatRoom.topic_id) {
      const db = require('../config/database');
      
      // Get poll options
      const options = await db.query(
        'SELECT * FROM poll_options WHERE topic_id = ? ORDER BY display_order',
        [chatRoom.topic_id]
      );
      
      // Get vote counts for each option
      for (let option of options) {
        const voteCount = await db.query(
          'SELECT COUNT(*) as count FROM poll_votes WHERE option_id = ?',
          [option.option_id]
        );
        option.vote_count = voteCount[0].count;
      }
      
      // Check if current user has voted
      const userVote = await db.query(
        'SELECT pv.*, po.option_text FROM poll_votes pv JOIN poll_options po ON pv.option_id = po.option_id WHERE po.topic_id = ? AND pv.user_id = ?',
        [chatRoom.topic_id, req.session.user.id]
      );
      
      pollData = {
        options: options,
        userHasVoted: userVote.length > 0,
        userVote: userVote[0] || null,
        totalVotes: options.reduce((sum, opt) => sum + opt.vote_count, 0)
      };
    }
    
    res.render('messageBoard/chatRoom', {
      title: `${chatRoom.room_name} - Message Board`,
      chatRoom,
      messages,
      pollData,
      activePage: 'message-board',
      layout: false // Use custom layout for chat functionality
    });
    
  } catch (error) {
    console.error('Error loading chat room:', error.message);
    req.flash('error_msg', 'Error loading chat room');
    res.redirect('/message-board');
  }
};

/**
 * Show create new chat/topic form
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getCreateForm = async (req, res) => {
  try {
    res.render('messageBoard/create', {
      title: 'Create New Discussion - Message Board',
      activePage: 'message-board'
    });
  } catch (error) {
    console.error('Error loading create form:', error.message);
    req.flash('error_msg', 'Error loading create form');
    res.redirect('/message-board');
  }
};

/**
 * Create a new topic with chat room
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.createTopicWithChat = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { title, content, postType, pollOptions } = req.body;
    const userId = req.session.user.id;
    
    // Get or create default category
    const db = require('../config/database');
    let categories = await db.query('SELECT category_id FROM forum_categories ORDER BY category_id LIMIT 1');
    
    let categoryId;
    if (categories.length === 0) {
      // Create default category if none exists
      const result = await db.query(
        'INSERT INTO forum_categories (category_name, description, display_order) VALUES (?, ?, ?)',
        ['General Discussion', 'Main discussion area for league members', 1]
      );
      categoryId = result.insertId;
    } else {
      categoryId = categories[0].category_id;
    }
    
    // Create topic with associated chat room
    const result = await Chat.createTopicWithChat({
      title,
      content,
      postType: postType || 'Discussion',
      categoryId: categoryId,
      userId
    });
    
    // If it's a poll, add the poll options
    if (postType === 'Poll' && pollOptions && pollOptions.length > 0) {
      for (let i = 0; i < pollOptions.length; i++) {
        if (pollOptions[i].trim()) {
          await db.query(
            'INSERT INTO poll_options (topic_id, option_text, display_order) VALUES (?, ?, ?)',
            [result.topic_id, pollOptions[i].trim(), i + 1]
          );
        }
      }
    }
    
    // Log the activity
    const activityDetails = {
      action: 'Created new discussion',
      entity_type: 'forum_topic',
      entity_id: result.topic_id,
      details: `Created "${title}" (${postType})`
    };
    
    res.json({
      success: true,
      message: 'Discussion created successfully',
      redirect: `/message-board/chat/${result.chat_room.room_id}`
    });
    
  } catch (error) {
    console.error('Error creating topic with chat:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error creating discussion'
    });
  }
};

/**
 * API: Get chat room messages
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getChatMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50 } = req.query;
    
    const messages = await Chat.getRoomMessages(roomId, limit);
    
    res.json({ success: true, messages });
    
  } catch (error) {
    console.error('Error getting chat messages:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving messages' 
    });
  }
};

/**
 * API: Send a chat message
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendChatMessage = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { roomId } = req.params;
    const { message } = req.body;
    const userId = req.session.user.id;
    
    // Send the message
    const newMessage = await Chat.sendMessage({
      roomId: parseInt(roomId),
      userId,
      message
    });
    
    if (newMessage) {
      // Emit real-time event to all users in the chat room
      const io = req.app.get('io');
      const messageBoardNamespace = io.of('/message-board');
      messageBoardNamespace.to(`room-${roomId}`).emit('chatMessage', newMessage);
    }
    
    res.json({ success: true, message: 'Message sent successfully' });
    
  } catch (error) {
    console.error('Error sending chat message:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error sending message' 
    });
  }
};

/**
 * API: Delete a chat room
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deleteChatRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.session.user.id;
    
    await Chat.deleteChatRoom(roomId, userId);
    
    res.json({ 
      success: true, 
      message: 'Chat room deleted successfully' 
    });
    
  } catch (error) {
    console.error('Error deleting chat room:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error deleting chat room' 
    });
  }
};