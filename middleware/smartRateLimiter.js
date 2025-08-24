/**
 * Smart Rate Limiting
 * More user-friendly rate limiting with progressive penalties
 */

const rateLimit = require('express-rate-limit');
const { logSecurityEvent, getClientIP } = require('./securityMonitor');

/**
 * Create a progressive rate limiter that gets stricter with repeated violations
 */
function createProgressiveAuthLimiter() {
  // Track violations per IP
  const violationTracker = new Map();

  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minute window
    max: (req) => {
      const clientIP = getClientIP(req);
      const violations = violationTracker.get(clientIP) || 0;
      
      // Progressive limits based on past violations
      if (violations === 0) return 30; // First time: very generous
      if (violations === 1) return 20; // Second violation: still generous  
      if (violations === 2) return 15; // Third violation: moderate
      if (violations >= 3) return 10; // Repeated violations: stricter
      
      return 20; // Default
    },
    
    skipSuccessfulRequests: true, // Don't count successful logins
    
    // Custom key generator to handle proxy situations better
    keyGenerator: (req) => {
      return getClientIP(req);
    },
    
    // More informative error messages
    handler: async (req, res) => {
      const clientIP = getClientIP(req);
      const violations = violationTracker.get(clientIP) || 0;
      
      // Track this violation
      violationTracker.set(clientIP, violations + 1);
      
      // Clear violations after 1 hour of good behavior
      setTimeout(() => {
        const currentViolations = violationTracker.get(clientIP) || 0;
        if (currentViolations > 0) {
          violationTracker.set(clientIP, Math.max(0, currentViolations - 1));
        }
      }, 60 * 60 * 1000);

      // Log the rate limit event
      await logSecurityEvent('RATE_LIMIT_EXCEEDED_AUTH', req, {
        violations: violations + 1,
        windowMs: 5 * 60 * 1000,
        currentLimit: req.rateLimit?.limit || 'unknown'
      });

      // Different messages based on context
      let message;
      if (req.originalUrl.includes('/api/')) {
        message = { 
          error: 'Too many login attempts. Please wait a few minutes before trying again.',
          retryAfter: Math.ceil((req.rateLimit?.resetTime || Date.now()) / 1000),
          suggestion: 'If you forgot your password, please use the password reset option.'
        };
      } else {
        // Web interface - render error page
        message = 'Too many login attempts. Please wait a few minutes before trying again.';
      }

      if (req.originalUrl.includes('/api/')) {
        res.status(429).json(message);
      } else {
        req.flash('error_msg', message);
        res.redirect('/login');
      }
    },
    
    standardHeaders: true,
    legacyHeaders: false
  });
}

/**
 * Create a more lenient limiter for general authentication-related actions
 */
function createGeneralAuthLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 50, // More generous for general auth actions (password resets, etc.)
    skipSuccessfulRequests: true,
    keyGenerator: (req) => getClientIP(req),
    
    handler: async (req, res) => {
      await logSecurityEvent('RATE_LIMIT_EXCEEDED_AUTH_GENERAL', req, {
        endpoint: req.originalUrl,
        windowMs: 10 * 60 * 1000
      });

      if (req.originalUrl.includes('/api/')) {
        res.status(429).json({ 
          error: 'Too many requests. Please slow down.',
          retryAfter: Math.ceil((req.rateLimit?.resetTime || Date.now()) / 1000)
        });
      } else {
        req.flash('error_msg', 'Too many requests. Please wait a moment and try again.');
        res.redirect('back');
      }
    }
  });
}

/**
 * Whitelist certain IPs from strict rate limiting (for development/admin use)
 */
function createWhitelistBypass(baseLimiter, whitelist = []) {
  return (req, res, next) => {
    const clientIP = getClientIP(req);
    
    // Check if IP is whitelisted (useful for development or known admin IPs)
    if (whitelist.includes(clientIP) || 
        (process.env.NODE_ENV === 'development' && 
         (clientIP.includes('127.0.0.1') || clientIP.includes('localhost')))) {
      return next();
    }
    
    return baseLimiter(req, res, next);
  };
}

module.exports = {
  createProgressiveAuthLimiter,
  createGeneralAuthLimiter,
  createWhitelistBypass
};