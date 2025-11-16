/**
 * Admin Security Monitoring Routes
 * Read-only security dashboard for administrators
 */

const express = require('express');
const router = express.Router();
const { ensureAuthenticated, isAdmin } = require('../../middleware/auth');
const { getSecuritySummary } = require('../../middleware/securityMonitor');
const db = require('../../config/database');

// Security dashboard main page
router.get('/', ensureAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get security summary for last 24 hours
    const securityData = await getSecuritySummary(24);
    
    res.render('admin/security-dashboard', {
      title: 'Security Dashboard',
      layout: 'layouts/layout',
      securityData,
      user: req.session.user
    });
  } catch (error) {
    console.error('Security dashboard error:', error);
    req.flash('error_msg', 'Error loading security dashboard');
    res.redirect('/admin');
  }
});

// API endpoint for security data (AJAX)
router.get('/api/summary', ensureAuthenticated, isAdmin, async (req, res) => {
  try {
    const timeframe = parseInt(req.query.hours) || 24;
    const securityData = await getSecuritySummary(timeframe);
    res.json(securityData);
  } catch (error) {
    console.error('Security API error:', error);
    res.status(500).json({ error: 'Failed to fetch security data' });
  }
});

// Get recent suspicious events
// NOTE: Security events are no longer stored in database to prevent bloat
router.get('/api/events', ensureAuthenticated, isAdmin, async (req, res) => {
  try {
    // Security monitoring events are now only logged to console
    // Check server logs for security event history
    res.json({
      events: [],
      note: 'Security events are no longer stored in database to prevent bloat. Check server logs for security monitoring data.'
    });
  } catch (error) {
    console.error('Security events API error:', error);
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
});

// Get IP analysis
// NOTE: Security events are no longer stored in database
router.get('/api/ip/:ip', ensureAuthenticated, isAdmin, async (req, res) => {
  try {
    const ip = req.params.ip;

    // Validate IP format (basic check)
    if (!/^[\d\.]+$/.test(ip) && !/^[\da-fA-F:]+$/.test(ip)) {
      return res.status(400).json({ error: 'Invalid IP address format' });
    }

    // Only get user-related activity (not security monitoring events)
    const activity = await db.query(`
      SELECT
        action_type,
        entity_type,
        details,
        created_at,
        user_id
      FROM activity_logs
      WHERE entity_id = ?
        AND entity_type != 'SECURITY_MONITOR'
        AND entity_type != 'SECURITY'
        AND created_at >= NOW() - INTERVAL 7 DAY
      ORDER BY created_at DESC
      LIMIT 100
    `, [ip]);

    // Get summary stats for this IP (excluding security monitoring events)
    const stats = await db.query(`
      SELECT
        COUNT(*) as total_events,
        COUNT(DISTINCT action_type) as unique_event_types,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM activity_logs
      WHERE entity_id = ?
        AND entity_type != 'SECURITY_MONITOR'
        AND entity_type != 'SECURITY'
        AND created_at >= NOW() - INTERVAL 30 DAY
    `, [ip]);

    res.json({
      ip,
      stats: stats[0] || {},
      recentActivity: activity.map(event => ({
        ...event,
        details: typeof event.details === 'string' ? JSON.parse(event.details) : event.details
      })),
      note: 'Security monitoring events are no longer stored in database. Check server logs for security data.'
    });
  } catch (error) {
    console.error('IP analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze IP address' });
  }
});

module.exports = router;