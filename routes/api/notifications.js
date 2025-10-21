const express = require('express');
const router = express.Router();
const Notification = require('../../models/Notification');
const { authenticateHybrid } = require('../../middleware/auth');
const { body, param, query, validationResult } = require('express-validator');

router.get('/', authenticateHybrid, [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  query('unreadOnly').optional().isBoolean().toBoolean(),
  query('type').optional().isIn(['trade', 'draft', 'waiver', 'league', 'player_update', 'keeper', 'system', 'message'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { limit = 50, offset = 0, unreadOnly = false, type = null } = req.query;
    
    const notifications = await Notification.getByUserId(req.user.id, {
      limit,
      offset,
      unreadOnly,
      type
    });

    const unreadCount = await Notification.getUnreadCount(req.user.id);

    res.json({
      notifications,
      unreadCount,
      pagination: {
        limit,
        offset,
        hasMore: notifications.length === limit
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.get('/unread-count', authenticateHybrid, async (req, res) => {
  try {
    const count = await Notification.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

router.put('/:id/read', authenticateHybrid, [
  param('id').isInt().toInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const success = await Notification.markAsRead(req.params.id, req.user.id);
    
    if (success) {
      res.json({ success: true, message: 'Notification marked as read' });
    } else {
      res.status(404).json({ error: 'Notification not found' });
    }
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.put('/mark-all-read', authenticateHybrid, [
  body('type').optional().isIn(['trade', 'draft', 'waiver', 'league', 'player_update', 'keeper', 'system', 'message'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const affectedRows = await Notification.markAllAsRead(req.user.id, req.body.type);
    
    res.json({ 
      success: true, 
      message: `${affectedRows} notifications marked as read` 
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

router.delete('/:id', authenticateHybrid, [
  param('id').isInt().toInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const success = await Notification.delete(req.params.id, req.user.id);
    
    if (success) {
      res.json({ success: true, message: 'Notification deleted' });
    } else {
      res.status(404).json({ error: 'Notification not found' });
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

router.get('/preferences', authenticateHybrid, async (req, res) => {
  try {
    const preferences = await Notification.getUserPreferences(req.user.id);
    res.json(preferences);
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

router.put('/preferences', authenticateHybrid, [
  body('actionType').notEmpty().trim(),
  body('emailEnabled').isBoolean().toBoolean(),
  body('siteEnabled').isBoolean().toBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { actionType, emailEnabled, siteEnabled } = req.body;
    
    const success = await Notification.updateUserPreferences(
      req.user.id,
      actionType,
      emailEnabled,
      siteEnabled
    );

    if (success) {
      res.json({ success: true, message: 'Preferences updated' });
    } else {
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

router.post('/test', authenticateHybrid, async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const notificationId = await Notification.create({
      userId: req.user.id,
      type: 'system',
      title: 'Test Notification',
      message: 'This is a test notification created at ' + new Date().toLocaleString(),
      priority: 'low'
    });

    res.json({ 
      success: true, 
      message: 'Test notification created',
      notificationId 
    });
  } catch (error) {
    console.error('Error creating test notification:', error);
    res.status(500).json({ error: 'Failed to create test notification' });
  }
});

// Get trade notifications for a specific team
router.get('/trades/:teamId', authenticateHybrid, [
  param('teamId').isInt().toInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Verify user owns this team
    const db = require('../../config/database');
    const teamCheck = await db.query(
      'SELECT user_id FROM fantasy_teams WHERE team_id = ?',
      [req.params.teamId]
    );

    if (teamCheck.length === 0 || teamCheck[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get trade notifications for the user
    const tradeNotifications = await Notification.getByUserId(req.user.id, {
      type: 'trade',
      unreadOnly: false,
      limit: 10
    });

    res.json({
      success: true,
      tradeNotifications
    });
  } catch (error) {
    console.error('Error fetching trade notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trade notifications'
    });
  }
});

module.exports = router;