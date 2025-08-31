/**
 * Non-disruptive Security Monitoring Middleware
 * Only logs suspicious activity, never blocks requests
 */

const db = require('../config/database');
const { processSecurityEvent } = require('./alertSystem');

// In-memory tracking (won't affect functionality)
const requestTracker = new Map();
const suspiciousPatterns = new Map();

/**
 * Get client IP address safely
 */
function getClientIP(req) {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress ||
         'unknown';
}

/**
 * Log security events (non-blocking)
 */
async function logSecurityEvent(eventType, req, additionalDetails = {}) {
  try {
    const clientIP = getClientIP(req);
    const details = {
      ip: clientIP,
      url: req.originalUrl,
      method: req.method,
      userAgent: req.headers['user-agent'] || 'unknown',
      timestamp: new Date().toISOString(),
      sessionId: req.sessionID || 'none',
      userId: req.session?.user?.user_id || null,
      ...additionalDetails
    };

    // Log to database (non-blocking)
    setImmediate(async () => {
      try {
        await db.query(
          `INSERT INTO activity_logs 
           (user_id, action_type, entity_type, entity_id, details, created_at) 
           VALUES (?, ?, 'SECURITY_MONITOR', NULL, ?, NOW())`,
          [
            details.userId,
            eventType,
            JSON.stringify(details)
          ]
        );
      } catch (dbError) {
        console.error('Security logging error:', dbError.message);
      }
    });

    // Console log for immediate visibility
    console.log(`[SECURITY MONITOR] ${eventType}: ${clientIP} - ${req.method} ${req.originalUrl}`);

    // Process for potential alerts (non-blocking)
    setImmediate(async () => {
      try {
        await processSecurityEvent(eventType, clientIP, details.userId, details);
      } catch (alertError) {
        console.error('Alert processing error:', alertError.message);
      }
    });
    
  } catch (error) {
    console.error('Security monitoring error:', error.message);
  }
}

/**
 * Monitor suspicious patterns without blocking
 */
function monitorRequestPatterns(req, res, next) {
  try {
    const clientIP = getClientIP(req);
    const now = Date.now();
    const url = req.originalUrl.toLowerCase();
    const method = req.method;
    const userAgent = req.headers['user-agent'] || '';

    // Initialize tracking for this IP
    if (!requestTracker.has(clientIP)) {
      requestTracker.set(clientIP, {
        requests: [],
        uniquePaths: new Set(),
        methods: new Set(),
        userAgents: new Set(),
        firstSeen: now
      });
    }

    const tracker = requestTracker.get(clientIP);
    tracker.requests.push({ time: now, path: req.path, method });
    tracker.uniquePaths.add(req.path);
    tracker.methods.add(method);
    tracker.userAgents.add(userAgent);

    // Keep only last 5 minutes of data
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    tracker.requests = tracker.requests.filter(r => r.time > fiveMinutesAgo);

    // Check for suspicious patterns (log only, don't block)
    
    // 1. High frequency requests
    if (tracker.requests.length > 100) {
      logSecurityEvent('HIGH_FREQUENCY_REQUESTS', req, {
        requestCount: tracker.requests.length,
        timeWindow: '5 minutes'
      });
    }

    // 2. Directory scanning
    if (tracker.uniquePaths.size > 20 && tracker.requests.length > 30) {
      logSecurityEvent('POTENTIAL_SCANNING', req, {
        uniquePaths: tracker.uniquePaths.size,
        totalRequests: tracker.requests.length
      });
    }

    // 3. Multiple user agents from same IP (potential bot)
    if (tracker.userAgents.size > 5) {
      logSecurityEvent('MULTIPLE_USER_AGENTS', req, {
        userAgentCount: tracker.userAgents.size,
        userAgents: Array.from(tracker.userAgents)
      });
    }

    // 4. Common attack patterns in URL
    const attackPatterns = [
      { pattern: /admin|wp-admin|phpmyadmin/i, type: 'ADMIN_PATH_PROBE' },
      { pattern: /\.php$|\.asp$|\.jsp$/, type: 'SCRIPT_PATH_PROBE' },
      { pattern: /\.\./i, type: 'PATH_TRAVERSAL_ATTEMPT' },
      { pattern: /union.*select|drop.*table|insert.*into/i, type: 'SQL_INJECTION_PATTERN' },
      { pattern: /<script|javascript:|onload=|onerror=/i, type: 'XSS_PATTERN' },
      { pattern: /\|\||&&|;|`|\$\(/i, type: 'COMMAND_INJECTION_PATTERN' }
    ];

    for (const { pattern, type } of attackPatterns) {
      if (pattern.test(url + JSON.stringify(req.query))) {
        logSecurityEvent(type, req, {
          matchedPattern: pattern.source,
          suspiciousContent: url.substring(0, 200) // Truncate for logging
        });
      }
    }

    // 5. Unusual HTTP methods
    if (['TRACE', 'CONNECT', 'DEBUG', 'TRACK'].includes(method)) {
      logSecurityEvent('UNUSUAL_HTTP_METHOD', req, {
        method: method
      });
    }

    // Clean up old tracking data (1% chance per request to avoid overhead)
    if (Math.random() < 0.01) {
      const oneHourAgo = now - (60 * 60 * 1000);
      for (const [ip, data] of requestTracker.entries()) {
        if (data.firstSeen < oneHourAgo && data.requests.length === 0) {
          requestTracker.delete(ip);
        }
      }
    }

  } catch (error) {
    console.error('Request monitoring error:', error.message);
  }

  next(); // Always continue to next middleware
}

/**
 * Monitor failed login attempts (enhance existing auth)
 */
function trackLoginAttempt(req, success, username) {
  try {
    const clientIP = getClientIP(req);
    
    if (!success) {
      logSecurityEvent('FAILED_LOGIN', req, {
        username: username || 'unknown',
        attempt: 'failed'
      });

      // Track consecutive failures
      if (!suspiciousPatterns.has(clientIP)) {
        suspiciousPatterns.set(clientIP, { failedLogins: 0, lastFailure: Date.now() });
      }
      
      const pattern = suspiciousPatterns.get(clientIP);
      pattern.failedLogins++;
      pattern.lastFailure = Date.now();

      // Log potential brute force (but don't block)
      if (pattern.failedLogins >= 5) {
        logSecurityEvent('POTENTIAL_BRUTE_FORCE', req, {
          username: username || 'unknown',
          consecutiveFailures: pattern.failedLogins,
          recommendation: 'Consider implementing account lockout'
        });
      }
    } else {
      // Clear failures on successful login
      suspiciousPatterns.delete(clientIP);
      
      logSecurityEvent('SUCCESSFUL_LOGIN', req, {
        username: username || 'unknown'
      });
    }
  } catch (error) {
    console.error('Login tracking error:', error.message);
  }
}

/**
 * Generate security summary for admins
 */
async function getSecuritySummary(timeframe = 24) {
  try {
    const hours = Math.min(Math.max(timeframe, 1), 168); // 1 hour to 7 days
    
    const summary = await db.query(`
      SELECT 
        action_type,
        COUNT(*) as event_count,
        COUNT(DISTINCT entity_id) as unique_ips,
        MAX(created_at) as last_occurrence
      FROM activity_logs 
      WHERE entity_type = 'SECURITY_MONITOR'
        AND created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY action_type
      ORDER BY event_count DESC
    `, [hours]);

    const recentEvents = await db.query(`
      SELECT 
        action_type,
        entity_id as ip_address,
        details,
        created_at
      FROM activity_logs 
      WHERE entity_type = 'SECURITY_MONITOR'
        AND created_at >= NOW() - INTERVAL ? HOUR
      ORDER BY created_at DESC
      LIMIT 100
    `, [Math.min(hours, 24)]); // Recent events limited to 24 hours

    return {
      summary,
      recentEvents,
      currentlyTracked: {
        activeIPs: requestTracker.size,
        suspiciousIPs: suspiciousPatterns.size
      },
      timeframe: `${hours} hours`
    };
  } catch (error) {
    console.error('Security summary error:', error.message);
    return { error: error.message };
  }
}

module.exports = {
  monitorRequestPatterns,
  trackLoginAttempt,
  logSecurityEvent,
  getSecuritySummary,
  getClientIP
};