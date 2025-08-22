const express = require('express');
const router = express.Router();
const UserPreference = require('../../models/UserPreference');
const User = require('../../models/user');
const { authenticateHybrid } = require('../../middleware/auth');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const db = require('../../config/database');

router.get('/', authenticateHybrid, async (req, res) => {
  try {
    const preferences = await UserPreference.getAll(req.user.id);
    
    if (Object.keys(preferences).length === 0) {
      await UserPreference.initializeDefaults(req.user.id);
      const newPreferences = await UserPreference.getAll(req.user.id);
      return res.json(newPreferences);
    }
    
    res.json(preferences);
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

router.put('/', authenticateHybrid, [
  body('preferences').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const success = await UserPreference.setBulk(req.user.id, req.body.preferences);
    
    if (success) {
      res.json({ success: true, message: 'Preferences updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

router.put('/password', authenticateHybrid, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  body('confirmPassword').custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Passwords do not match')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = await User.findById(req.user.id);
    
    const [dbUser] = await db.query(
      'SELECT password_hash FROM users WHERE user_id = ?',
      [req.user.id]
    );

    const isValid = await User.comparePassword(req.body.currentPassword, dbUser.password_hash);
    
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const success = await User.update(req.user.id, { password: req.body.newPassword });
    
    if (success) {
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'PASSWORD_CHANGED', 'USER', req.user.id, 'Password changed']
      );
      
      res.json({ success: true, message: 'Password updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update password' });
    }
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

router.put('/email', authenticateHybrid, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const [dbUser] = await db.query(
      'SELECT password_hash FROM users WHERE user_id = ?',
      [req.user.id]
    );

    const isValid = await User.comparePassword(req.body.password, dbUser.password_hash);
    
    if (!isValid) {
      return res.status(400).json({ error: 'Password is incorrect' });
    }

    const existingUser = await User.findByEmail(req.body.email);
    if (existingUser && existingUser.user_id !== req.user.id) {
      return res.status(400).json({ error: 'Email address is already in use' });
    }

    const success = await User.update(req.user.id, { email: req.body.email });
    
    if (success) {
      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'EMAIL_CHANGED', 'USER', req.user.id, 'Email address changed']
      );
      
      res.json({ success: true, message: 'Email updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update email' });
    }
  } catch (error) {
    console.error('Error updating email:', error);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

router.put('/username', authenticateHybrid, [
  body('username').trim().isLength({ min: 3, max: 20 }),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const [dbUser] = await db.query(
      'SELECT password_hash FROM users WHERE user_id = ?',
      [req.user.id]
    );

    const isValid = await User.comparePassword(req.body.password, dbUser.password_hash);
    
    if (!isValid) {
      return res.status(400).json({ error: 'Password is incorrect' });
    }

    // Check if username already exists
    const existingUser = await User.findByUsername(req.body.username);
    if (existingUser && existingUser.user_id !== req.user.id) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const success = await User.update(req.user.id, { username: req.body.username });
    
    if (success) {
      // Update session data
      if (req.session && req.session.user) {
        req.session.user.username = req.body.username;
      }

      await db.query(
        'INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'USERNAME_CHANGED', 'USER', req.user.id, `Username changed to ${req.body.username}`]
      );
      
      res.json({ success: true, message: 'Username updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update username' });
    }
  } catch (error) {
    console.error('Error updating username:', error);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

router.put('/profile', authenticateHybrid, [
  body('bio').optional().trim(),
  body('favoriteNflTeam').optional().isInt().toInt(),
  body('isProfilePublic').optional().isBoolean().toBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = [];
    const params = [];

    if (req.body.bio !== undefined) {
      updates.push('bio = ?');
      params.push(req.body.bio);
    }

    if (req.body.favoriteNflTeam !== undefined) {
      updates.push('favorite_nfl_team = ?');
      params.push(req.body.favoriteNflTeam);
    }

    if (req.body.isProfilePublic !== undefined) {
      updates.push('is_profile_public = ?');
      params.push(req.body.isProfilePublic);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.user.id);

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
      params
    );

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Profile updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update profile' });
    }
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/theme', authenticateHybrid, async (req, res) => {
  try {
    const theme = await UserPreference.get(req.user.id, 'theme') || 'light';
    res.json({ theme });
  } catch (error) {
    console.error('Error fetching theme:', error);
    res.status(500).json({ error: 'Failed to fetch theme' });
  }
});

router.put('/theme', authenticateHybrid, [
  body('theme').isIn(['light', 'dark'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const success = await UserPreference.set(req.user.id, 'theme', req.body.theme);
    
    if (success) {
      res.json({ success: true, message: 'Theme updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update theme' });
    }
  } catch (error) {
    console.error('Error updating theme:', error);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

module.exports = router;