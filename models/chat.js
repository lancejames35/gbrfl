/**
 * Chat Model
 * Handles chat functionality for both draft room and message board
 */

const db = require('../config/database');

class Chat {
  /**
   * Create a new chat room
   * @param {Object} chatData - Chat room data
   * @returns {Promise<Object>} Created chat room
   */
  static async createChatRoom(chatData) {
    try {
      const { name, roomType = 'general', topicId = null, createdBy } = chatData;
      
      const result = await db.query(
        'INSERT INTO chat_rooms (room_name, room_type, topic_id, created_by) VALUES (?, ?, ?, ?)',
        [name, roomType, topicId, createdBy]
      );
      
      return { 
        room_id: result.insertId, 
        room_name: name, 
        room_type: roomType, 
        topic_id: topicId,
        created_by: createdBy 
      };
    } catch (error) {
      console.error('Error creating chat room:', error.message);
      throw error;
    }
  }

  /**
   * Get all active chat rooms for message board
   * @returns {Promise<Array>} List of chat rooms with metadata
   */
  static async getAllChatRooms() {
    try {
      const rooms = await db.query(`
        SELECT cr.*, 
               u.first_name, u.last_name,
               ft.title as topic_title,
               ft.post_type as topic_type,
               CASE 
                 WHEN cr.room_type = 'draft' THEN (
                   SELECT COUNT(*) FROM draft_chat
                 )
                 ELSE (
                   SELECT COUNT(*) FROM chat_messages cm WHERE cm.room_id = cr.room_id
                 )
               END as message_count,
               CASE 
                 WHEN cr.room_type = 'draft' THEN (
                   SELECT MAX(created_at) FROM draft_chat
                 )
                 ELSE (
                   SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.room_id = cr.room_id
                 )
               END as last_message_at
        FROM chat_rooms cr
        JOIN users u ON cr.created_by = u.user_id
        LEFT JOIN forum_topics ft ON cr.topic_id = ft.topic_id
        WHERE cr.is_active = 1
        ORDER BY cr.room_type = 'draft' DESC, cr.created_at DESC
      `);
      
      return rooms;
    } catch (error) {
      console.error('Error getting chat rooms:', error.message);
      throw error;
    }
  }

  /**
   * Get chat room by ID
   * @param {number} roomId - Room ID
   * @returns {Promise<Object|null>} Chat room data
   */
  static async getChatRoomById(roomId) {
    try {
      const rooms = await db.query(`
        SELECT cr.*, 
               u.first_name, u.last_name,
               ft.title as topic_title,
               ft.post_type as topic_type,
               ft.content as topic_content
        FROM chat_rooms cr
        JOIN users u ON cr.created_by = u.user_id
        LEFT JOIN forum_topics ft ON cr.topic_id = ft.topic_id
        WHERE cr.room_id = ? AND cr.is_active = 1
      `, [roomId]);
      
      return rooms[0] || null;
    } catch (error) {
      console.error('Error getting chat room:', error.message);
      throw error;
    }
  }

  /**
   * Get messages for a specific chat room
   * @param {number} roomId - Room ID
   * @param {number} limit - Message limit (default 50, max 100)
   * @returns {Promise<Array>} List of messages
   */
  static async getRoomMessages(roomId, limit = 50) {
    try {
      const messageLimit = Math.min(parseInt(limit) || 50, 100);
      
      // Check if this is the draft room (room_id = 1)
      const room = await this.getChatRoomById(roomId);
      if (!room) {
        throw new Error('Chat room not found');
      }
      
      let messages;
      if (room.room_type === 'draft') {
        // Use existing draft_chat table for draft room
        messages = await db.query(`
          SELECT dc.message_id, dc.user_id, dc.message, dc.message_type, dc.created_at,
                 u.username, u.first_name, u.last_name, ft.team_name
          FROM draft_chat dc
          JOIN users u ON dc.user_id = u.user_id
          LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
          ORDER BY dc.created_at DESC
          LIMIT ${messageLimit}
        `);
      } else {
        // Use chat_messages table for other rooms
        messages = await db.query(`
          SELECT cm.*, u.username, u.first_name, u.last_name, ft.team_name
          FROM chat_messages cm
          JOIN users u ON cm.user_id = u.user_id
          LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
          WHERE cm.room_id = ?
          ORDER BY cm.created_at DESC
          LIMIT ${messageLimit}
        `, [roomId]);
      }
      
      // Reverse to show oldest first
      return messages.reverse();
    } catch (error) {
      console.error('Error getting room messages:', error.message);
      throw error;
    }
  }

  /**
   * Send a message to a chat room
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} Sent message with user data
   */
  static async sendMessage(messageData) {
    try {
      const { roomId, userId, message, messageType = 'user' } = messageData;
      
      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }
      
      if (message.length > 500) {
        throw new Error('Message too long (max 500 characters)');
      }
      
      // Check if this is the draft room
      const room = await this.getChatRoomById(roomId);
      if (!room) {
        throw new Error('Chat room not found');
      }
      
      let result, newMessage;
      
      if (room.room_type === 'draft') {
        // Insert into draft_chat table for draft room
        result = await db.query(
          'INSERT INTO draft_chat (user_id, message, message_type, created_at) VALUES (?, ?, ?, NOW())',
          [userId, message.trim(), messageType]
        );
        
        // Get the complete message data
        newMessage = await db.query(`
          SELECT dc.message_id, dc.user_id, dc.message, dc.message_type, dc.created_at,
                 u.username, u.first_name, u.last_name, ft.team_name
          FROM draft_chat dc
          JOIN users u ON dc.user_id = u.user_id
          LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
          WHERE dc.message_id = ?
        `, [result.insertId]);
      } else {
        // Insert into chat_messages table for other rooms
        result = await db.query(
          'INSERT INTO chat_messages (room_id, user_id, message, message_type, created_at) VALUES (?, ?, ?, ?, NOW())',
          [roomId, userId, message.trim(), messageType]
        );
        
        // Get the complete message data
        newMessage = await db.query(`
          SELECT cm.*, u.username, u.first_name, u.last_name, ft.team_name
          FROM chat_messages cm
          JOIN users u ON cm.user_id = u.user_id
          LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
          WHERE cm.message_id = ?
        `, [result.insertId]);
      }
      
      return newMessage[0] || null;
    } catch (error) {
      console.error('Error sending message:', error.message);
      throw error;
    }
  }

  /**
   * Create a new forum topic with associated chat room
   * @param {Object} topicData - Topic data
   * @returns {Promise<Object>} Created topic and chat room
   */
  static async createTopicWithChat(topicData) {
    try {
      const { title, content, postType, categoryId, userId } = topicData;
      
      // Create forum topic
      const topicResult = await db.query(
        'INSERT INTO forum_topics (category_id, user_id, title, content, post_type) VALUES (?, ?, ?, ?, ?)',
        [categoryId, userId, title, content, postType]
      );
      
      const topicId = topicResult.insertId;
      
      // Create associated chat room
      const chatRoom = await this.createChatRoom({
        name: title,
        roomType: 'topic',
        topicId: topicId,
        createdBy: userId
      });
      
      return {
        topic_id: topicId,
        chat_room: chatRoom
      };
    } catch (error) {
      console.error('Error creating topic with chat:', error.message);
      throw error;
    }
  }

  /**
   * Delete a chat room (soft delete)
   * @param {number} roomId - Room ID
   * @param {number} userId - User ID (must be room creator or admin)
   * @returns {Promise<boolean>} Success status
   */
  static async deleteChatRoom(roomId, userId) {
    try {
      // Don't allow deleting the draft room
      if (roomId === 1) {
        throw new Error('Cannot delete the draft room');
      }
      
      // Check if user can delete (creator or admin)
      const room = await db.query(
        'SELECT created_by FROM chat_rooms WHERE room_id = ?',
        [roomId]
      );
      
      const user = await db.query(
        'SELECT is_admin FROM users WHERE user_id = ?',
        [userId]
      );
      
      if (!room[0] || (!user[0]?.is_admin && room[0].created_by !== userId)) {
        throw new Error('Permission denied');
      }
      
      // Soft delete
      await db.query(
        'UPDATE chat_rooms SET is_active = 0 WHERE room_id = ?',
        [roomId]
      );
      
      return true;
    } catch (error) {
      console.error('Error deleting chat room:', error.message);
      throw error;
    }
  }

  /**
   * Get draft room specifically (for existing draft functionality)
   * @returns {Promise<Object|null>} Draft room data
   */
  static async getDraftRoom() {
    try {
      const rooms = await db.query(`
        SELECT cr.*, u.first_name, u.last_name
        FROM chat_rooms cr
        JOIN users u ON cr.created_by = u.user_id
        WHERE cr.room_type = 'draft' AND cr.is_active = 1
        LIMIT 1
      `);
      
      return rooms[0] || null;
    } catch (error) {
      console.error('Error getting draft room:', error.message);
      throw error;
    }
  }
}

module.exports = Chat;