const db = require('../config/database');

class Notification {
  static async create({ userId, type, title, message, actionUrl = null, metadata = null, priority = 'medium', logId = null }) {
    try {
      let query, params;
      
      if (logId) {
        query = `INSERT INTO notifications 
                 (user_id, type, title, message, action_url, metadata, priority, log_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        params = [userId, type, title, message, actionUrl, JSON.stringify(metadata), priority, logId];
      } else {
        query = `INSERT INTO notifications 
                 (user_id, type, title, message, action_url, metadata, priority) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
        params = [userId, type, title, message, actionUrl, JSON.stringify(metadata), priority];
      }
      
      const result = await db.query(query, params);
      return result.insertId;
    } catch (error) {
      console.error('Error creating notification:', error.message);
      throw error;
    }
  }

  static async createFromTemplate(templateKey, userId, data = {}) {
    try {
      const [template] = await db.query(
        'SELECT * FROM notification_templates WHERE template_key = ?',
        [templateKey]
      );

      if (!template) {
        throw new Error(`Notification template '${templateKey}' not found`);
      }

      let title = template.title_template;
      let message = template.message_template;
      
      Object.keys(data).forEach(key => {
        const placeholder = `{{${key}}}`;
        title = title.replace(new RegExp(placeholder, 'g'), data[key]);
        message = message.replace(new RegExp(placeholder, 'g'), data[key]);
      });

      return await this.create({
        userId,
        type: template.type,
        title,
        message,
        priority: template.default_priority,
        metadata: data
      });
    } catch (error) {
      console.error('Error creating notification from template:', error.message);
      throw error;
    }
  }

  static async createBulk(notifications) {
    try {
      const values = notifications.map(n => [
        n.userId,
        n.type || 'system',
        n.title,
        n.message,
        n.actionUrl || null,
        JSON.stringify(n.metadata || null),
        n.priority || 'medium',
        n.logId || null
      ]);

      const placeholders = notifications.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const flatValues = values.flat();

      const result = await db.query(
        `INSERT INTO notifications 
         (user_id, type, title, message, action_url, metadata, priority, log_id) 
         VALUES ${placeholders}`,
        flatValues
      );

      return result.insertId;
    } catch (error) {
      console.error('Error creating bulk notifications:', error.message);
      throw error;
    }
  }

  static async getByUserId(userId, { limit = 50, offset = 0, unreadOnly = false, type = null } = {}) {
    try {
      console.log('Getting notifications for user:', userId, { limit, offset, unreadOnly, type });
      
      // Ensure parameters are the correct types
      const limitNum = parseInt(limit, 10);
      const offsetNum = parseInt(offset, 10);
      
      let query = `SELECT n.* FROM notifications n WHERE n.user_id = ?`;
      const params = [userId];

      if (unreadOnly) {
        query += ' AND n.is_read = FALSE';
      }

      if (type) {
        query += ' AND n.type = ?';
        params.push(type);
      }

      // Use string interpolation for LIMIT and OFFSET to avoid parameter binding issues
      query += ` ORDER BY n.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

      console.log('Executing query:', query, 'with params:', params);
      const notifications = await db.query(query, params);
      console.log('Found notifications:', notifications.length);
      
      return notifications.map(n => ({
        ...n,
        metadata: n.metadata ? this.safeJsonParse(n.metadata) : null
      }));
    } catch (error) {
      console.error('Error getting user notifications:', error.message, error);
      throw error;
    }
  }

  static safeJsonParse(jsonString) {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.warn('Failed to parse notification metadata:', jsonString);
      return null;
    }
  }

  static async getUnreadCount(userId) {
    try {
      const [result] = await db.query(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
        [userId]
      );
      return result.count;
    } catch (error) {
      console.error('Error getting unread count:', error.message);
      throw error;
    }
  }

  static async markAsRead(notificationId, userId) {
    try {
      const result = await db.query(
        'UPDATE notifications SET is_read = TRUE WHERE notification_id = ? AND user_id = ?',
        [notificationId, userId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error marking notification as read:', error.message);
      throw error;
    }
  }

  static async markAllAsRead(userId, type = null) {
    try {
      let query = 'UPDATE notifications SET is_read = TRUE WHERE user_id = ?';
      const params = [userId];

      if (type) {
        query += ' AND type = ?';
        params.push(type);
      }

      const result = await db.query(query, params);
      return result.affectedRows;
    } catch (error) {
      console.error('Error marking all notifications as read:', error.message);
      throw error;
    }
  }

  static async delete(notificationId, userId) {
    try {
      const result = await db.query(
        'DELETE FROM notifications WHERE notification_id = ? AND user_id = ?',
        [notificationId, userId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting notification:', error.message);
      throw error;
    }
  }

  static async deleteOld(daysOld = 30) {
    try {
      const result = await db.query(
        'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
        [daysOld]
      );
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting old notifications:', error.message);
      throw error;
    }
  }

  static async notifyTradeProposal(fromTeamId, toTeamId, tradeId) {
    try {
      const [fromTeam] = await db.query(
        `SELECT ft.team_name, u.user_id 
         FROM fantasy_teams ft 
         JOIN users u ON ft.user_id = u.user_id 
         WHERE ft.team_id = ?`,
        [fromTeamId]
      );

      const [toTeam] = await db.query(
        `SELECT u.user_id 
         FROM fantasy_teams ft 
         JOIN users u ON ft.user_id = u.user_id 
         WHERE ft.team_id = ?`,
        [toTeamId]
      );

      if (fromTeam && toTeam) {
        await this.createFromTemplate('trade_proposed', toTeam.user_id, {
          proposer: fromTeam.team_name,
          trade_id: tradeId
        });
      }
    } catch (error) {
      console.error('Error notifying trade proposal:', error.message);
      throw error;
    }
  }

  static async notifyDraftTurn(teamId) {
    try {
      const [team] = await db.query(
        `SELECT u.user_id 
         FROM fantasy_teams ft 
         JOIN users u ON ft.user_id = u.user_id 
         WHERE ft.team_id = ?`,
        [teamId]
      );

      if (team) {
        await this.createFromTemplate('draft_turn', team.user_id, {
          team_id: teamId
        });
      }
    } catch (error) {
      console.error('Error notifying draft turn:', error.message);
      throw error;
    }
  }

  static async getUserPreferences(userId) {
    try {
      const prefs = await db.query(
        'SELECT * FROM notification_settings WHERE user_id = ?',
        [userId]
      );
      
      const prefMap = {};
      prefs.forEach(p => {
        prefMap[p.action_type] = {
          email: p.is_email_enabled,
          site: p.is_site_enabled
        };
      });
      
      return prefMap;
    } catch (error) {
      console.error('Error getting user notification preferences:', error.message);
      throw error;
    }
  }

  static async updateUserPreferences(userId, actionType, emailEnabled, siteEnabled) {
    try {
      const result = await db.query(
        `INSERT INTO notification_settings (user_id, action_type, is_email_enabled, is_site_enabled) 
         VALUES (?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         is_email_enabled = VALUES(is_email_enabled),
         is_site_enabled = VALUES(is_site_enabled)`,
        [userId, actionType, emailEnabled, siteEnabled]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating notification preferences:', error.message);
      throw error;
    }
  }
}

module.exports = Notification;