const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const Notification = require('../models/Notification');

/**
 * @route   GET /notifications
 * @desc    View all notifications page
 * @access  Private
 */
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Get notifications for current user
    const notifications = await Notification.getByUserId(req.user.id, {
      limit: limit + 1, // Get one extra to check if there are more pages
      offset
    });
    
    const hasNextPage = notifications.length > limit;
    if (hasNextPage) {
      notifications.pop(); // Remove the extra notification
    }
    
    const unreadCount = await Notification.getUnreadCount(req.user.id);
    
    res.render('notifications/index', {
      title: 'Notifications | GBRFL',
      user: req.user,
      notifications,
      unreadCount,
      currentPage: page,
      hasNextPage,
      hasPrevPage: page > 1,
      activePage: 'notifications'
    });
  } catch (error) {
    console.error('Error loading notifications page:', error);
    req.flash('error_msg', 'Error loading notifications');
    res.redirect('/dashboard');
  }
});

module.exports = router;