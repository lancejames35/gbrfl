/**
 * Enhanced Security Middleware
 * Provides attack detection, IP blocking, and security monitoring
 */

const db = require('../config/database');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

// In-memory stores for performance (consider Redis in production)
const suspiciousIPs = new Map();
const blockedIPs = new Set();
const failedLoginAttempts = new Map();
const requestPatterns = new Map();

/**
 * Security event types for logging
 */
const SECURITY_EVENTS = {
  BRUTE_FORCE: 'BRUTE_FORCE_ATTEMPT',
  SQL_INJECTION: 'SQL_INJECTION_ATTEMPT',
  XSS_ATTEMPT: 'XSS_ATTEMPT',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL_ATTEMPT',
  SUSPICIOUS_PATTERN: 'SUSPICIOUS_PATTERN',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  BLOCKED_IP: 'BLOCKED_IP_ACCESS',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  SESSION_HIJACK: 'SESSION_HIJACK_ATTEMPT',
  CSRF_ATTEMPT: 'CSRF_ATTEMPT'
};

/**
 * Log security event to database
 */
async function logSecurityEvent(eventType, ipAddress, userId = null, details = {}) {
  try {
    await db.query(
      `INSERT INTO activity_logs 
       (user_id, action_type, entity_type, entity_id, details, created_at) 
       VALUES (?, ?, 'SECURITY', ?, ?, NOW())`,
      [
        userId,
        eventType,
        ipAddress,
        JSON.stringify({
          ...details,
          timestamp: new Date().toISOString(),
          userAgent: details.userAgent || 'unknown'
        })
      ]
    );

    // Check if IP should be blocked based on severity
    await evaluateIPThreat(ipAddress, eventType);
  } catch (error) {
    console.error('Error logging security event:', error);
  }
}

/**
 * Get client IP address (handles proxies)
 */
function getClientIP(req) {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress;
}

/**
 * Evaluate if an IP should be blocked based on threat patterns
 */
async function evaluateIPThreat(ipAddress, eventType) {
  if (!suspiciousIPs.has(ipAddress)) {
    suspiciousIPs.set(ipAddress, {
      events: [],
      score: 0,
      firstSeen: Date.now()
    });
  }

  const ipData = suspiciousIPs.get(ipAddress);
  ipData.events.push({ type: eventType, timestamp: Date.now() });

  // Assign threat scores
  const threatScores = {
    [SECURITY_EVENTS.SQL_INJECTION]: 50,
    [SECURITY_EVENTS.XSS_ATTEMPT]: 40,
    [SECURITY_EVENTS.BRUTE_FORCE]: 30,
    [SECURITY_EVENTS.PATH_TRAVERSAL]: 35,
    [SECURITY_EVENTS.SESSION_HIJACK]: 60,
    [SECURITY_EVENTS.CSRF_ATTEMPT]: 45,
    [SECURITY_EVENTS.RATE_LIMIT_EXCEEDED]: 10,
    [SECURITY_EVENTS.SUSPICIOUS_PATTERN]: 20
  };

  ipData.score += threatScores[eventType] || 10;

  // Auto-block if score exceeds threshold
  if (ipData.score >= 100) {
    blockedIPs.add(ipAddress);
    console.log(`[SECURITY] Auto-blocked IP ${ipAddress} - Threat score: ${ipData.score}`);
    
    // Store in database for persistence
    try {
      await db.query(
        `INSERT INTO blocked_ips (ip_address, reason, blocked_at, auto_blocked) 
         VALUES (?, ?, NOW(), 1)
         ON DUPLICATE KEY UPDATE 
         reason = VALUES(reason), blocked_at = NOW()`,
        [ipAddress, `Auto-blocked: Threat score ${ipData.score}`]
      );
    } catch (error) {
      console.error('Error storing blocked IP:', error);
    }
  }
}

/**
 * Check if IP is blocked
 */
async function checkBlockedIP(req, res, next) {
  const clientIP = getClientIP(req);

  // Check in-memory blocked list
  if (blockedIPs.has(clientIP)) {
    await logSecurityEvent(
      SECURITY_EVENTS.BLOCKED_IP,
      clientIP,
      null,
      { url: req.originalUrl, method: req.method }
    );
    return res.status(403).json({ error: 'Access denied' });
  }

  // Check database for persistent blocks
  try {
    const blocked = await db.query(
      'SELECT * FROM blocked_ips WHERE ip_address = ? AND (unblocked_at IS NULL OR unblocked_at > NOW())',
      [clientIP]
    );

    if (blocked.length > 0) {
      blockedIPs.add(clientIP); // Cache it
      await logSecurityEvent(
        SECURITY_EVENTS.BLOCKED_IP,
        clientIP,
        null,
        { url: req.originalUrl, method: req.method }
      );
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    console.error('Error checking blocked IP:', error);
  }

  next();
}

/**
 * Detect common attack patterns in requests
 */
function detectAttackPatterns(req, res, next) {
  const clientIP = getClientIP(req);
  const url = req.originalUrl;
  const body = JSON.stringify(req.body || {});
  const query = JSON.stringify(req.query || {});
  const headers = JSON.stringify(req.headers || {});

  // SQL Injection patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE)\b)/gi,
    /(--)|(;)|(\|\|)|(\/\*)/,
    /(\')|(\")|(--)|(%27)|(%22)/,
    /(\bOR\b\s*\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s*\d+\s*=\s*\d+)/gi,
    /(EXEC(\s|\+)+(X|S)P\w+)/gi
  ];

  // XSS patterns
  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<img[^>]*onerror=/gi,
    /alert\s*\(/gi,
    /document\.(cookie|write|location)/gi
  ];

  // Path traversal patterns
  const pathTraversalPatterns = [
    /\.\.\//g,
    /\.\.%2F/gi,
    /%2e%2e/gi,
    /\.\.;/g
  ];

  // Command injection patterns
  const cmdPatterns = [
    /(\||;|`|&|\$\()/,
    /(nc\s+-|bash\s+-|sh\s+-|curl\s+|wget\s+)/gi
  ];

  const checkPatterns = (text, patterns, eventType) => {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        logSecurityEvent(
          eventType,
          clientIP,
          req.session?.user?.user_id || null,
          {
            url: req.originalUrl,
            method: req.method,
            pattern: pattern.toString(),
            userAgent: req.headers['user-agent']
          }
        );
        return true;
      }
    }
    return false;
  };

  // Check all inputs for attack patterns
  const combinedInput = `${url} ${body} ${query} ${headers}`;

  if (checkPatterns(combinedInput, sqlPatterns, SECURITY_EVENTS.SQL_INJECTION)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (checkPatterns(combinedInput, xssPatterns, SECURITY_EVENTS.XSS_ATTEMPT)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (checkPatterns(url, pathTraversalPatterns, SECURITY_EVENTS.PATH_TRAVERSAL)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (checkPatterns(combinedInput, cmdPatterns, SECURITY_EVENTS.SUSPICIOUS_PATTERN)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  next();
}

/**
 * Track failed login attempts for brute force protection
 */
async function trackFailedLogin(ipAddress, username) {
  const key = `${ipAddress}:${username}`;
  
  if (!failedLoginAttempts.has(key)) {
    failedLoginAttempts.set(key, {
      count: 0,
      firstAttempt: Date.now(),
      lastAttempt: Date.now()
    });
  }

  const attempts = failedLoginAttempts.get(key);
  attempts.count++;
  attempts.lastAttempt = Date.now();

  // Check if it's a brute force attempt (5+ failures in 5 minutes)
  if (attempts.count >= 5) {
    const timeWindow = 5 * 60 * 1000; // 5 minutes
    if (attempts.lastAttempt - attempts.firstAttempt <= timeWindow) {
      await logSecurityEvent(
        SECURITY_EVENTS.BRUTE_FORCE,
        ipAddress,
        null,
        {
          username,
          attempts: attempts.count,
          timeWindow: timeWindow / 1000
        }
      );

      // Temporarily block this IP
      blockedIPs.add(ipAddress);
      
      // Auto-unblock after 30 minutes
      setTimeout(() => {
        blockedIPs.delete(ipAddress);
      }, 30 * 60 * 1000);
    }
  }

  // Clean old attempts after 30 minutes
  setTimeout(() => {
    failedLoginAttempts.delete(key);
  }, 30 * 60 * 1000);
}

/**
 * Clear failed login attempts on successful login
 */
function clearFailedLoginAttempts(ipAddress, username) {
  const key = `${ipAddress}:${username}`;
  failedLoginAttempts.delete(key);
}

/**
 * Detect suspicious request patterns (high frequency, scanning)
 */
function detectSuspiciousPatterns(req, res, next) {
  const clientIP = getClientIP(req);
  const now = Date.now();

  if (!requestPatterns.has(clientIP)) {
    requestPatterns.set(clientIP, {
      requests: [],
      uniquePaths: new Set()
    });
  }

  const pattern = requestPatterns.get(clientIP);
  pattern.requests.push({ time: now, path: req.path });
  pattern.uniquePaths.add(req.path);

  // Keep only last 60 seconds of data
  pattern.requests = pattern.requests.filter(r => now - r.time < 60000);

  // Detect scanning (many unique paths in short time)
  if (pattern.uniquePaths.size > 50 && pattern.requests.length > 100) {
    logSecurityEvent(
      SECURITY_EVENTS.SUSPICIOUS_PATTERN,
      clientIP,
      req.session?.user?.user_id || null,
      {
        type: 'scanning',
        uniquePaths: pattern.uniquePaths.size,
        totalRequests: pattern.requests.length
      }
    );
    pattern.uniquePaths.clear();
  }

  // Clean old data periodically
  if (Math.random() < 0.01) { // 1% chance to clean
    for (const [ip, data] of requestPatterns.entries()) {
      if (data.requests.length === 0) {
        requestPatterns.delete(ip);
      }
    }
  }

  next();
}

/**
 * Enhanced rate limiting with dynamic adjustment
 */
function createDynamicRateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    handler: async (req, res) => {
      const clientIP = getClientIP(req);
      await logSecurityEvent(
        SECURITY_EVENTS.RATE_LIMIT_EXCEEDED,
        clientIP,
        req.session?.user?.user_id || null,
        {
          url: req.originalUrl,
          method: req.method,
          limit: options.max
        }
      );
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
    skip: (req) => {
      // Skip rate limiting for blocked IPs (they're already blocked)
      return blockedIPs.has(getClientIP(req));
    }
  });
}

/**
 * Input sanitization middleware
 */
const sanitizeInput = [
  body('*').trim().escape(),
  (req, res, next) => {
    // Recursively sanitize nested objects
    const sanitizeObject = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Remove null bytes and control characters
          obj[key] = obj[key].replace(/\0/g, '').replace(/[\x00-\x1F\x7F]/g, '');
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        }
      }
    };

    if (req.body) sanitizeObject(req.body);
    if (req.query) sanitizeObject(req.query);
    if (req.params) sanitizeObject(req.params);

    next();
  }
];

/**
 * Load blocked IPs from database on startup
 */
async function loadBlockedIPs() {
  try {
    const blocked = await db.query(
      'SELECT ip_address FROM blocked_ips WHERE unblocked_at IS NULL OR unblocked_at > NOW()'
    );
    blocked.forEach(row => blockedIPs.add(row.ip_address));
    console.log(`[SECURITY] Loaded ${blocked.length} blocked IPs`);
  } catch (error) {
    console.error('Error loading blocked IPs:', error);
  }
}

// Initialize on module load
loadBlockedIPs();

// Clean up old suspicious IP data every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [ip, data] of suspiciousIPs.entries()) {
    if (data.firstSeen < oneHourAgo && data.score < 50) {
      suspiciousIPs.delete(ip);
    }
  }
}, 3600000);

module.exports = {
  checkBlockedIP,
  detectAttackPatterns,
  detectSuspiciousPatterns,
  trackFailedLogin,
  clearFailedLoginAttempts,
  createDynamicRateLimiter,
  sanitizeInput,
  logSecurityEvent,
  SECURITY_EVENTS,
  getClientIP
};