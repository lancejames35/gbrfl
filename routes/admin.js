/**
 * Admin Routes
 * Handles all routes related to admin functionality
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const multer = require('multer');
const path = require('path');
const adminController = require('../controllers/adminController');
const { ensureAuthenticated, isAdmin } = require('../middleware/auth');

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function(req, file, cb) {
    cb(null, 'players-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 5 }, // 5MB max file size
  fileFilter: function(req, file, cb) {
    // Accept only CSV files
    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      return cb(new Error('Only CSV files are allowed'));
    }
    cb(null, true);
  }
});

// Ensure uploads directory exists
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

/**
 * @route   GET /admin
 * @desc    Admin dashboard
 * @access  Private/Admin
 */
router.get('/', ensureAuthenticated, isAdmin, adminController.getDashboard);

/**
 * @route   GET /admin/players
 * @desc    NFL Player management
 * @access  Private/Admin
 */
router.get('/players', ensureAuthenticated, isAdmin, adminController.getPlayerManagement);

/**
 * @route   GET /admin/players/upload
 * @desc    Display NFL Player CSV upload page
 * @access  Private/Admin
 */
router.get('/players/upload', ensureAuthenticated, isAdmin, adminController.getPlayerUpload);

/**
 * @route   POST /admin/players/upload
 * @desc    Process NFL Player CSV upload
 * @access  Private/Admin
 */
router.post('/players/upload', ensureAuthenticated, isAdmin, upload.single('playersCsv'), adminController.processPlayerUpload);

/**
 * @route   GET /admin/players/add
 * @desc    Display form to add a new NFL player
 * @access  Private/Admin
 */
router.get('/players/add', ensureAuthenticated, isAdmin, adminController.getAddPlayer);

/**
 * @route   POST /admin/players/add
 * @desc    Add a new NFL player
 * @access  Private/Admin
 */
router.post('/players/add', ensureAuthenticated, isAdmin, [
  check('firstName', 'First name is required').not().isEmpty(),
  check('lastName', 'Last name is required').not().isEmpty(),
  check('position', 'Position is required').not().isEmpty()
], adminController.addPlayer);

/**
 * @route   GET /admin/players/edit/:id
 * @desc    Display form to edit an NFL player
 * @access  Private/Admin
 */
router.get('/players/edit/:id', ensureAuthenticated, isAdmin, adminController.getEditPlayer);

/**
 * @route   POST /admin/players/edit/:id
 * @desc    Edit an NFL player
 * @access  Private/Admin
 */
router.post('/players/edit/:id', ensureAuthenticated, isAdmin, [
  check('firstName', 'First name is required').not().isEmpty(),
  check('lastName', 'Last name is required').not().isEmpty(),
  check('position', 'Position is required').not().isEmpty()
], adminController.editPlayer);

/**
 * @route   POST /admin/players/delete/:id
 * @desc    Delete an NFL player
 * @access  Private/Admin
 */
router.post('/players/delete/:id', ensureAuthenticated, isAdmin, adminController.deletePlayer);

/**
 * @route   POST /admin/undo-pick
 * @desc    Undo the last draft pick
 * @access  Private/Admin
 */
router.post('/undo-pick', ensureAuthenticated, isAdmin, adminController.undoLastPick);

/**
 * @route   GET /admin/schedules
 * @desc    Schedule management interface
 * @access  Private/Admin
 */
router.get('/schedules', ensureAuthenticated, isAdmin, adminController.getScheduleManagement);

/**
 * @route   GET /admin/trades
 * @desc    Trade approval dashboard
 * @access  Private/Admin
 */
router.get('/trades', ensureAuthenticated, isAdmin, adminController.getTradeApprovals);

/**
 * @route   GET /admin/waivers
 * @desc    Waiver wire approval interface
 * @access  Private/Admin
 */
router.get('/waivers', ensureAuthenticated, isAdmin, adminController.getWaiverApprovals);

/**
 * @route   GET /admin/users
 * @desc    User management panel
 * @access  Private/Admin
 */
router.get('/users', ensureAuthenticated, isAdmin, adminController.getUserManagement);

/**
 * @route   POST /admin/users/:id/reset-password
 * @desc    Reset user password
 * @access  Private/Admin
 */
router.post('/users/:id/reset-password', ensureAuthenticated, isAdmin, adminController.resetUserPassword);

/**
 * @route   POST /admin/users/:id/toggle-admin
 * @desc    Toggle user admin status
 * @access  Private/Admin
 */
router.post('/users/:id/toggle-admin', ensureAuthenticated, isAdmin, adminController.toggleUserAdmin);

/**
 * @route   POST /admin/users/:id/toggle-status
 * @desc    Toggle user active status (enable/disable)
 * @access  Private/Admin
 */
router.post('/users/:id/toggle-status', ensureAuthenticated, isAdmin, adminController.toggleUserStatus);

/**
 * @route   GET /admin/users/:id/login-history
 * @desc    Get user login history
 * @access  Private/Admin
 */
router.get('/users/:id/login-history', ensureAuthenticated, isAdmin, adminController.getUserLoginHistory);

/**
 * @route   GET /admin/users/:id/activity
 * @desc    Get user activity logs
 * @access  Private/Admin
 */
router.get('/users/:id/activity', ensureAuthenticated, isAdmin, adminController.getUserActivity);

/**
 * @route   POST /admin/users/:id/update-profile
 * @desc    Update user profile information
 * @access  Private/Admin
 */
router.post('/users/:id/update-profile', ensureAuthenticated, isAdmin, adminController.updateUserProfile);

/**
 * @route   GET /admin/settings
 * @desc    League settings configuration
 * @access  Private/Admin
 */
router.get('/settings', ensureAuthenticated, isAdmin, adminController.getLeagueSettings);

/**
 * @route   GET /admin/logs
 * @desc    Activity log viewer
 * @access  Private/Admin
 */
router.get('/logs', ensureAuthenticated, isAdmin, adminController.getActivityLogs);

/**
 * @route   GET /admin/import-export
 * @desc    Data import/export tools
 * @access  Private/Admin
 */
router.get('/import-export', ensureAuthenticated, isAdmin, adminController.getImportExport);

/**
 * @route   POST /admin/schedules/assignments
 * @desc    Save team position assignments
 * @access  Private/Admin
 */
router.post('/schedules/assignments', ensureAuthenticated, isAdmin, adminController.updateTeamAssignments);

/**
 * @route   GET /admin/schedules/preview
 * @desc    AJAX endpoint for schedule preview
 * @access  Private/Admin
 */
router.get('/schedules/preview', ensureAuthenticated, isAdmin, adminController.getSchedulePreview);

/**
 * @route   POST /admin/schedules/notes
 * @desc    Create schedule note
 * @access  Private/Admin
 */
router.post('/schedules/notes', ensureAuthenticated, isAdmin, adminController.createScheduleNote);

/**
 * @route   PUT /admin/schedules/notes/:id
 * @desc    Update schedule note
 * @access  Private/Admin
 */
router.put('/schedules/notes/:id', ensureAuthenticated, isAdmin, adminController.updateScheduleNote);

/**
 * @route   DELETE /admin/schedules/notes/:id
 * @desc    Delete schedule note
 * @access  Private/Admin
 */
router.delete('/schedules/notes/:id', ensureAuthenticated, isAdmin, adminController.deleteScheduleNote);

/**
 * @route   GET /admin/draft-order
 * @desc    View and manage draft order
 * @access  Private/Admin
 */
router.get('/draft-order', ensureAuthenticated, isAdmin, adminController.getDraftOrder);

/**
 * @route   GET /admin/draft-order/data
 * @desc    Get draft order data as JSON
 * @access  Private/Admin
 */
router.get('/draft-order/data', ensureAuthenticated, isAdmin, adminController.getDraftOrderData);

/**
 * @route   PUT /admin/draft-order
 * @desc    Update draft order
 * @access  Private/Admin
 */
router.put('/draft-order', ensureAuthenticated, isAdmin, adminController.updateDraftOrder);

/**
 * @route   GET /admin/player-audit
 * @desc    Player team audit tool
 * @access  Private/Admin
 */
router.get('/player-audit', ensureAuthenticated, isAdmin, adminController.getPlayerAudit);

/**
 * @route   POST /admin/player-audit/fix
 * @desc    Fix player team assignments
 * @access  Private/Admin
 */
router.post('/player-audit/fix', ensureAuthenticated, isAdmin, adminController.fixPlayerTeams);

/**
 * @route   GET /admin/lineup-locks
 * @desc    Lineup lock management interface
 * @access  Private/Admin
 */
router.get('/lineup-locks', ensureAuthenticated, isAdmin, adminController.getLineupLockManagement);

/**
 * @route   POST /admin/lineup-locks/set-lock-time
 * @desc    Set lock time for a specific week
 * @access  Private/Admin
 */
router.post('/lineup-locks/set-lock-time', ensureAuthenticated, isAdmin, [
  check('week_number', 'Week number is required').isInt({ min: 1, max: 17 }),
  check('lock_datetime', 'Lock date/time is required').notEmpty()
], adminController.setLineupLockTime);

/**
 * @route   POST /admin/lineup-locks/toggle-lock
 * @desc    Manually lock/unlock a specific week
 * @access  Private/Admin
 */
router.post('/lineup-locks/toggle-lock', ensureAuthenticated, isAdmin, [
  check('week_number', 'Week number is required').isInt({ min: 1, max: 17 }),
  check('is_locked', 'Lock status is required').isBoolean()
], adminController.toggleLineupLock);

/**
 * @route   GET /admin/lineup-locks/data
 * @desc    Get lineup lock data for AJAX
 * @access  Private/Admin
 */
router.get('/lineup-locks/data', ensureAuthenticated, isAdmin, adminController.getLineupLockData);


module.exports = router;