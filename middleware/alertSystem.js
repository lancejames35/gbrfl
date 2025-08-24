/**
 * Simple Alert System
 * Generates notifications for critical security events
 */

const db = require('../config/database');

// Alert thresholds and configurations
const ALERT_CONFIG = {
  BRUTE_FORCE: {
    threshold: 10, // 10 failed attempts from same IP
    timeWindow: 5 * 60 * 1000, // 5 minutes
    severity: 'HIGH'
  },
  HIGH_FREQUENCY: {
    threshold: 200, // 200+ requests in timeframe
    timeWindow: 5 * 60 * 1000, // 5 minutes
    severity: 'MEDIUM'
  },
  SCANNING: {
    threshold: 30, // 30+ unique paths
    timeWindow: 10 * 60 * 1000, // 10 minutes
    severity: 'MEDIUM'
  },
  INJECTION_ATTEMPTS: {
    threshold: 5, // 5+ injection attempts
    timeWindow: 15 * 60 * 1000, // 15 minutes
    severity: 'HIGH'
  }
};

// In-memory alert tracking
const alertTracker = new Map();

/**
 * Process security event and generate alerts if needed
 */
async function processSecurityEvent(eventType, ipAddress, userId = null, details = {}) {
  try {
    const now = Date.now();
    const key = `${ipAddress}:${eventType}`;

    // Initialize tracking for this IP/event combination
    if (!alertTracker.has(key)) {
      alertTracker.set(key, {
        count: 0,
        firstOccurrence: now,
        lastOccurrence: now,
        alerted: false
      });
    }

    const tracker = alertTracker.get(key);
    tracker.count++;
    tracker.lastOccurrence = now;

    // Check for alert conditions
    await checkAlertConditions(eventType, ipAddress, tracker, userId, details);

    // Clean up old tracking data periodically
    if (Math.random() < 0.01) { // 1% chance
      cleanupOldTrackers();
    }

  } catch (error) {
    console.error('Alert processing error:', error.message);
  }
}

/**
 * Check if alert conditions are met
 */
async function checkAlertConditions(eventType, ipAddress, tracker, userId, details) {
  // Map event types to alert categories
  const alertMappings = {
    'FAILED_LOGIN': 'BRUTE_FORCE',
    'POTENTIAL_BRUTE_FORCE': 'BRUTE_FORCE',
    'HIGH_FREQUENCY_REQUESTS': 'HIGH_FREQUENCY',
    'POTENTIAL_SCANNING': 'SCANNING',
    'SQL_INJECTION_PATTERN': 'INJECTION_ATTEMPTS',
    'XSS_PATTERN': 'INJECTION_ATTEMPTS',
    'COMMAND_INJECTION_PATTERN': 'INJECTION_ATTEMPTS'
  };

  const alertType = alertMappings[eventType];
  if (!alertType || !ALERT_CONFIG[alertType]) {
    return; // No alert configuration for this event type
  }

  const config = ALERT_CONFIG[alertType];
  const timeWindow = config.timeWindow;

  // Check if we're within the time window and threshold
  if (tracker.lastOccurrence - tracker.firstOccurrence <= timeWindow &&
      tracker.count >= config.threshold &&
      !tracker.alerted) {

    // Generate alert
    await generateAlert(alertType, ipAddress, tracker, config, userId, details);
    tracker.alerted = true;
  }
}

/**
 * Generate and store security alert
 */
async function generateAlert(alertType, ipAddress, tracker, config, userId, details) {
  try {
    const alertData = {
      type: alertType,
      severity: config.severity,
      ipAddress: ipAddress,
      userId: userId,
      eventCount: tracker.count,
      timeWindow: config.timeWindow / 1000, // Convert to seconds
      firstOccurrence: new Date(tracker.firstOccurrence),
      lastOccurrence: new Date(tracker.lastOccurrence),
      details: details
    };

    // Store alert in database
    await db.query(
      `INSERT INTO activity_logs 
       (user_id, action_type, entity_type, entity_id, details, created_at) 
       VALUES (?, ?, 'SECURITY_ALERT', ?, ?, NOW())`,
      [
        userId,
        `ALERT_${alertType}`,
        ipAddress,
        JSON.stringify(alertData)
      ]
    );

    // Log to console for immediate visibility
    console.log(`[SECURITY ALERT] ${config.severity} - ${alertType} from ${ipAddress}`);
    console.log(`  Events: ${tracker.count} in ${config.timeWindow/1000}s`);
    console.log(`  Details:`, JSON.stringify(details, null, 2));

    // In a production system, you might:
    // - Send email notifications
    // - Post to Slack/Discord
    // - Trigger automated responses
    // - Update external monitoring systems

  } catch (error) {
    console.error('Alert generation error:', error.message);
  }
}

/**
 * Clean up old tracking data
 */
function cleanupOldTrackers() {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  for (const [key, tracker] of alertTracker.entries()) {
    if (now - tracker.lastOccurrence > maxAge) {
      alertTracker.delete(key);
    }
  }
}

/**
 * Get recent alerts for dashboard
 */
async function getRecentAlerts(hours = 24) {
  try {
    const alerts = await db.query(
      `SELECT 
        action_type,
        entity_id as ip_address,
        user_id,
        details,
        created_at
       FROM activity_logs 
       WHERE entity_type = 'SECURITY_ALERT'
         AND created_at >= NOW() - INTERVAL ? HOUR
       ORDER BY created_at DESC
       LIMIT 50`,
      [hours]
    );

    return alerts.map(alert => ({
      ...alert,
      details: typeof alert.details === 'string' ? JSON.parse(alert.details) : alert.details
    }));
  } catch (error) {
    console.error('Error fetching recent alerts:', error.message);
    return [];
  }
}

/**
 * Get alert statistics
 */
async function getAlertStats(hours = 24) {
  try {
    const stats = await db.query(
      `SELECT 
        COUNT(*) as total_alerts,
        COUNT(CASE WHEN JSON_EXTRACT(details, '$.severity') = 'HIGH' THEN 1 END) as high_severity,
        COUNT(CASE WHEN JSON_EXTRACT(details, '$.severity') = 'MEDIUM' THEN 1 END) as medium_severity,
        COUNT(CASE WHEN JSON_EXTRACT(details, '$.severity') = 'LOW' THEN 1 END) as low_severity,
        COUNT(DISTINCT entity_id) as unique_ips
       FROM activity_logs 
       WHERE entity_type = 'SECURITY_ALERT'
         AND created_at >= NOW() - INTERVAL ? HOUR`,
      [hours]
    );

    return stats[0] || {
      total_alerts: 0,
      high_severity: 0,
      medium_severity: 0,
      low_severity: 0,
      unique_ips: 0
    };
  } catch (error) {
    console.error('Error fetching alert stats:', error.message);
    return {
      total_alerts: 0,
      high_severity: 0,
      medium_severity: 0,
      low_severity: 0,
      unique_ips: 0
    };
  }
}

/**
 * Check if there are any critical alerts requiring immediate attention
 */
async function getCriticalAlerts() {
  try {
    const critical = await db.query(
      `SELECT 
        action_type,
        entity_id as ip_address,
        details,
        created_at
       FROM activity_logs 
       WHERE entity_type = 'SECURITY_ALERT'
         AND JSON_EXTRACT(details, '$.severity') = 'HIGH'
         AND created_at >= NOW() - INTERVAL 1 HOUR
       ORDER BY created_at DESC
       LIMIT 10`
    );

    return critical.map(alert => ({
      ...alert,
      details: typeof alert.details === 'string' ? JSON.parse(alert.details) : alert.details
    }));
  } catch (error) {
    console.error('Error fetching critical alerts:', error.message);
    return [];
  }
}

module.exports = {
  processSecurityEvent,
  getRecentAlerts,
  getAlertStats,
  getCriticalAlerts
};