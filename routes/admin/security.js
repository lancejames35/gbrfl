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
router.get('/api/events', ensureAuthenticated, isAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const hours = Math.min(parseInt(req.query.hours) || 24, 168);
    
    const events = await db.query(`
      SELECT 
        action_type,
        entity_id as ip_address,
        user_id,
        details,
        created_at,
        CASE 
          WHEN action_type IN ('POTENTIAL_BRUTE_FORCE', 'SQL_INJECTION_PATTERN', 'COMMAND_INJECTION_PATTERN') THEN 'HIGH'
          WHEN action_type IN ('XSS_PATTERN', 'PATH_TRAVERSAL_ATTEMPT', 'POTENTIAL_SCANNING') THEN 'MEDIUM'
          ELSE 'LOW'
        END as severity
      FROM activity_logs 
      WHERE entity_type = 'SECURITY_MONITOR'
        AND created_at >= NOW() - INTERVAL ? HOUR
      ORDER BY 
        FIELD(severity, 'HIGH', 'MEDIUM', 'LOW'),
        created_at DESC
      LIMIT ?
    `, [hours, limit]);

    // Parse details JSON for each event
    const processedEvents = events.map(event => ({
      ...event,
      details: typeof event.details === 'string' ? JSON.parse(event.details) : event.details
    }));

    res.json(processedEvents);
  } catch (error) {
    console.error('Security events API error:', error);
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
});

// Get IP analysis
router.get('/api/ip/:ip', ensureAuthenticated, isAdmin, async (req, res) => {
  try {
    const ip = req.params.ip;
    
    // Validate IP format (basic check)
    if (!/^[\d\.]+$/.test(ip) && !/^[\da-fA-F:]+$/.test(ip)) {
      return res.status(400).json({ error: 'Invalid IP address format' });
    }

    // Get all activity for this IP
    const activity = await db.query(`
      SELECT 
        action_type,
        entity_type,
        details,
        created_at,
        user_id
      FROM activity_logs 
      WHERE entity_id = ?
        AND created_at >= NOW() - INTERVAL 7 DAY
      ORDER BY created_at DESC
      LIMIT 100
    `, [ip]);

    // Get summary stats for this IP
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT action_type) as unique_event_types,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen,
        COUNT(CASE WHEN entity_type = 'SECURITY_MONITOR' THEN 1 END) as security_events
      FROM activity_logs 
      WHERE entity_id = ?
        AND created_at >= NOW() - INTERVAL 30 DAY
    `, [ip]);

    res.json({
      ip,
      stats: stats[0] || {},
      recentActivity: activity.map(event => ({
        ...event,
        details: typeof event.details === 'string' ? JSON.parse(event.details) : event.details
      }))
    });
  } catch (error) {
    console.error('IP analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze IP address' });
  }
});

module.exports = router;