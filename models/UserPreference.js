const db = require('../config/database');

class UserPreference {
  static async get(userId, key) {
    try {
      const [pref] = await db.query(
        'SELECT preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?',
        [userId, key]
      );
      return pref ? pref.preference_value : null;
    } catch (error) {
      console.error('Error getting user preference:', error.message);
      throw error;
    }
  }

  static async getAll(userId) {
    try {
      const prefs = await db.query(
        'SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ?',
        [userId]
      );
      
      const prefMap = {};
      prefs.forEach(p => {
        try {
          prefMap[p.preference_key] = JSON.parse(p.preference_value);
        } catch {
          prefMap[p.preference_key] = p.preference_value;
        }
      });
      
      return prefMap;
    } catch (error) {
      console.error('Error getting all user preferences:', error.message);
      throw error;
    }
  }

  static async set(userId, key, value) {
    try {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      
      const result = await db.query(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         preference_value = VALUES(preference_value),
         updated_at = CURRENT_TIMESTAMP`,
        [userId, key, stringValue]
      );
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error setting user preference:', error.message);
      throw error;
    }
  }

  static async setBulk(userId, preferences) {
    try {
      const values = Object.entries(preferences).map(([key, value]) => {
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return [userId, key, stringValue];
      });

      if (values.length === 0) return true;

      const placeholders = values.map(() => '(?, ?, ?)').join(', ');
      const flatValues = values.flat();

      const result = await db.query(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value) 
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE 
         preference_value = VALUES(preference_value),
         updated_at = CURRENT_TIMESTAMP`,
        flatValues
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error setting bulk preferences:', error.message);
      throw error;
    }
  }

  static async delete(userId, key) {
    try {
      const result = await db.query(
        'DELETE FROM user_preferences WHERE user_id = ? AND preference_key = ?',
        [userId, key]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting user preference:', error.message);
      throw error;
    }
  }

  static async getDefaultPreferences() {
    return {
      theme: 'light',
      email_notifications: {
        trade: true,
        draft: true,
        waiver: true,
        league: true,
        player_update: false,
        keeper: true,
        system: false,
        message: true
      },
      display: {
        table_density: 'comfortable',
        show_player_images: true,
        default_sort: 'rank',
        items_per_page: 25
      },
      privacy: {
        profile_public: true,
        show_trade_block: true,
        show_activity: true
      },
      notifications: {
        digest_frequency: 'immediate',
        quiet_hours_enabled: false,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00'
      }
    };
  }

  static async initializeDefaults(userId) {
    try {
      const defaults = await this.getDefaultPreferences();
      const flattened = {};
      
      Object.entries(defaults).forEach(([category, values]) => {
        if (typeof values === 'object') {
          flattened[category] = values;
        } else {
          flattened[category] = values;
        }
      });

      return await this.setBulk(userId, flattened);
    } catch (error) {
      console.error('Error initializing default preferences:', error.message);
      throw error;
    }
  }
}

module.exports = UserPreference;