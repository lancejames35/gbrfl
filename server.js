// Set timezone for the application
process.env.TZ = process.env.TZ || 'America/Chicago';

/**
 * GBRFL Fantasy Football League Web Application
 * Main server file
 */

// Load environment variables
require('dotenv').config();

// Core dependencies
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');

// Initialize database connection
const db = require('./config/database');

// ESPN Import Scheduler
const cron = require('cron');
const { main: runEspnImport } = require('./scripts/espnImportRunner');

// Security monitoring (non-disruptive)
const { monitorRequestPatterns } = require('./middleware/securityMonitor');

// Initialize the app
const app = express();

// Test database connection on startup
db.testConnection()
  .then(connected => {
    if (!connected) {
      console.warn('Warning: Application started with database connection issues');
    }
  })
  .catch(err => {
    console.error('Failed to test database connection:', err);
  });

// Schedule ESPN import to run daily at 3 AM
const espnImportJob = new cron.CronJob(
  '0 3 * * *', // 3:00 AM every day
  async () => {
    console.log(`Starting scheduled ESPN import at ${new Date().toISOString()}`);
    try {
      await runEspnImport();
      console.log(`ESPN import completed successfully at ${new Date().toISOString()}`);
    } catch (error) {
      console.error(`ESPN import failed at ${new Date().toISOString()}:`, error);
    }
  },
  null, // onComplete
  true, // start immediately
  'America/Chicago' // timezone
);

console.log('ESPN import scheduled for 3:00 AM daily (Chicago time)');

// Auto-lock lineups when lock time passes
const LineupLock = require('./models/LineupLock');

const autoLockJob = new cron.CronJob(
  '*/5 * * * *', // Every 5 minutes
  async () => {
    try {
      const lockedWeeks = await LineupLock.autoLockExpiredWeeks(2025);
      if (lockedWeeks.length > 0) {
        console.log(`[AUTO-LOCK] Locked ${lockedWeeks.length} week(s): ${lockedWeeks.map(w => `Week ${w.week_number}`).join(', ')}`);
      }
    } catch (error) {
      console.error('[AUTO-LOCK] Failed:', error);
    }
  },
  null, // onComplete
  true, // start immediately
  'America/Chicago' // timezone
);

console.log('Auto-lock job scheduled (checks every 5 minutes)');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", // Required for EJS inline styles - consider moving to external files
        "https://cdn.jsdelivr.net", 
        "https://cdnjs.cloudflare.com"
      ],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", // Required for EJS inline scripts - consider using nonces
        "'unsafe-hashes'", // Required for inline event handlers (onclick, etc.)
        "https://cdn.jsdelivr.net", 
        "https://cdnjs.cloudflare.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"], // Allow inline event handlers
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"], // Prevent clickjacking
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

// Enable CORS with restrictions
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In production, allow Railway domains and any custom domain
    if (process.env.NODE_ENV === 'production') {
      if (origin.includes('railway.app') || 
          origin.includes('leaguestation.com') ||
          origin === process.env.FRONTEND_URL) {
        return callback(null, true);
      }
    } else {
      // In development, allow localhost variants
      if (origin.includes('localhost') || 
          origin.includes('127.0.0.1') || 
          origin.includes('railway.app')) {
        return callback(null, true);
      }
    }
    
    console.log('CORS blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Request logging
app.use(morgan('dev'));

// Security monitoring (runs after CORS and headers, before rate limiting)
app.use(monitorRequestPatterns);

// Smart rate limiting for authentication endpoints
const { createProgressiveAuthLimiter } = require('./middleware/smartRateLimiter');

const authLimiter = createProgressiveAuthLimiter();

const { logSecurityEvent, getClientIP } = require('./middleware/securityMonitor');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes  
  max: 1000, // Increased from 500 to 1000 requests per 15 minutes for general endpoints
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting in development for localhost
    if (process.env.NODE_ENV === 'development') {
      const clientIP = getClientIP(req);
      if (clientIP.includes('127.0.0.1') || clientIP.includes('localhost') || clientIP === '::1') {
        return true;
      }
    }
    return false;
  },
  handler: async (req, res) => {
    // Log rate limit exceeded event
    await logSecurityEvent('RATE_LIMIT_EXCEEDED_GENERAL', req, {
      limit: 1000,
      windowMs: 15 * 60 * 1000,
      endpoint: 'general'
    });
    res.status(429).json({ error: 'Too many requests, please slow down.' });
  }
});

// Apply general rate limiting to all requests except notifications
app.use((req, res, next) => {
  // Skip rate limiting for notification endpoints
  if (req.path.startsWith('/api/notifications')) {
    return next();
  }
  return generalLimiter(req, res, next);
});

// Apply stricter rate limiting to auth endpoints
app.use('/login', authLimiter);
app.use('/register', authLimiter);
app.use('/api/auth', authLimiter);

// Parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up session management
const MySQLStore = require('express-mysql-session')(session);

// Configure session store using same database connection as your app
let sessionStoreConfig;
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  sessionStoreConfig = {
    host: url.hostname,
    port: url.port || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1)
  };
} else {
  sessionStoreConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  };
}

const sessionStore = new MySQLStore(sessionStoreConfig);

// Trust proxy in production (Railway runs behind a proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Validate session secret exists in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is required in production');
  process.exit(1);
}

app.use(session({
  key: 'gbrfl_session',
  secret: process.env.SESSION_SECRET || 'dev-only-weak-secret-change-in-production',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // Helps with cookie persistence
  },
  proxy: process.env.NODE_ENV === 'production' // Trust proxy in production
}));

// Flash messages
app.use(flash());

// Set global variables for templates
app.use(async (req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.user = req.session.user || null;
  
  // Make originalAdmin available for impersonation tracking
  res.locals.originalAdmin = req.session.originalAdmin || null;
  
  // For admin users, fetch all users for user switching functionality
  if (req.session.user && req.session.user.isAdmin) {
    try {
      const allUsers = await db.query(`
        SELECT u.user_id, u.username, u.first_name, u.last_name, 
               ft.team_name, ft.team_id
        FROM users u
        LEFT JOIN fantasy_teams ft ON u.user_id = ft.user_id
        ORDER BY u.first_name, u.last_name
      `);
      res.locals.allUsers = allUsers || [];
    } catch (error) {
      console.error('Error fetching users for admin:', error);
      res.locals.allUsers = [];
    }
  } else {
    res.locals.allUsers = [];
  }
  
  next();
});

// Set up templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Setup layout
app.use(expressLayouts);
app.set('layout', 'layouts/layout');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/admin/security', require('./routes/admin/security'));
app.use('/api/players', require('./routes/api/players')); 
app.use('/api/transactions', require('./routes/api/transactions'));
app.use('/api/teams', require('./routes/api/teams'));
app.use('/api/scoreboard', require('./routes/api/scoreboard'));
app.use('/api/notifications', require('./routes/api/notifications'));
app.use('/api/preferences', require('./routes/api/preferences'));
app.use('/api', require('./routes/api/serverInfo')); 

// Main homepage route - MUST be before any middleware that might handle /
app.get('/', (req, res) => {
  console.log('=== HOMEPAGE ACCESS ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session user:', req.session?.user);
  console.log('Session exists:', !!req.session);
  console.log('=== END HOMEPAGE ===');
  
  // If user is logged in, redirect to dashboard
  if (req.session && req.session.user) {
    console.log('Redirecting to dashboard');
    return res.redirect('/dashboard');
  }
  
  // Redirect non-logged-in users to login page
  console.log('Redirecting to login');
  res.redirect('/login');
});

// Web routes
app.use('/', require('./routes/webAuth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/teams', require('./routes/teams'));
app.use('/keepers', require('./routes/keepers'));
app.use('/waivers', require('./routes/waivers'));
// app.use('/trades', require('./routes/trades')); // TODO: Uncomment when trade routes are complete
app.use('/draft', require('./routes/draft'));
app.use('/players', require('./routes/players'));
app.use('/history', require('./routes/history'));
app.use('/champions', require('./routes/champions'));
app.use('/rules', require('./routes/rules'));
app.use('/schedule', require('./routes/schedule'));
app.use('/standings', require('./routes/standings'));
app.use('/transactions', require('./routes/transactions'));
app.use('/message-board', require('./routes/messageBoard'));
app.use('/lineups', require('./routes/lineups'));
app.use('/scoreboard', require('./routes/scoreboard'));
app.use('/scoreboard-results', require('./routes/scoreboard-manual'));
app.use('/notifications', require('./routes/notifications'));
app.use('/settings', require('./routes/settings'));
app.use('/profile', require('./routes/profile'));



// 404 handler
app.use((req, res, next) => {
  res.status(404).render('404', { 
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    title: 'Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message,
    error: process.env.NODE_ENV === 'production' ? {} : err
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`http://localhost:${PORT}`);
  }
});

// Initialize Socket.io
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Draft room namespace (keep existing functionality unchanged)
const draftNamespace = io.of('/draft');

draftNamespace.on('connection', (socket) => {
  console.log(`User connected to draft room: ${socket.id}`);
  
  // Join the draft room
  socket.join('draft-room');
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected from draft room: ${socket.id}`);
  });
});

// Message Board namespace for general chat rooms
const messageBoardNamespace = io.of('/message-board');

// Track users in each room
const roomUsers = new Map();

messageBoardNamespace.on('connection', (socket) => {
  console.log(`User connected to message board: ${socket.id}`);
  
  // Handle joining a specific chat room
  socket.on('joinRoom', (data) => {
    const { roomId } = data;
    const roomName = `room-${roomId}`;
    
    // Leave any existing rooms
    Array.from(socket.rooms).forEach(room => {
      if (room.startsWith('room-')) {
        socket.leave(room);
        updateRoomUserCount(room);
      }
    });
    
    // Join the new room
    socket.join(roomName);
    socket.currentRoom = roomName;
    socket.roomId = roomId;
    
    console.log(`User ${socket.id} joined room ${roomName}`);
    
    // Update user count for the room
    updateRoomUserCount(roomName);
  });
  
  // Handle typing indicators
  socket.on('typing', (data) => {
    const { roomId, user } = data;
    socket.to(`room-${roomId}`).emit('userTyping', { user });
  });
  
  socket.on('stopTyping', (data) => {
    const { roomId, user } = data;
    socket.to(`room-${roomId}`).emit('userStoppedTyping', { user });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected from message board: ${socket.id}`);
    
    // Update user count when user leaves
    if (socket.currentRoom) {
      updateRoomUserCount(socket.currentRoom);
    }
  });
  
  // Function to update and broadcast user count for a room
  function updateRoomUserCount(roomName) {
    const clients = messageBoardNamespace.adapter.rooms.get(roomName);
    const userCount = clients ? clients.size : 0;
    
    messageBoardNamespace.to(roomName).emit('userCountUpdate', { count: userCount });
  }
});

// Make io available to other modules

app.set('io', io);
