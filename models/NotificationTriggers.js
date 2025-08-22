const db = require('../config/database');
const Notification = require('./Notification');

class NotificationTriggers {
  
  // TRADE NOTIFICATIONS
  static async notifyTradeProposed(tradeId, fromTeamId, toTeamId) {
    try {
      // Get team and user information
      const [fromTeam] = await db.query(`
        SELECT ft.team_name, u.user_id, u.first_name, u.last_name
        FROM fantasy_teams ft 
        JOIN users u ON ft.user_id = u.user_id 
        WHERE ft.team_id = ?`, [fromTeamId]);

      const [toTeam] = await db.query(`
        SELECT ft.team_name, u.user_id
        FROM fantasy_teams ft 
        JOIN users u ON ft.user_id = u.user_id 
        WHERE ft.team_id = ?`, [toTeamId]);

      if (fromTeam && toTeam) {
        await Notification.create({
          userId: toTeam.user_id,
          type: 'trade',
          title: 'New Trade Proposal',
          message: `${fromTeam.first_name} ${fromTeam.last_name} (${fromTeam.team_name}) has proposed a trade with you`,
          actionUrl: `/trades/${tradeId}`,
          metadata: {
            trade_id: tradeId,
            from_team_id: fromTeamId,
            to_team_id: toTeamId,
            proposer_name: `${fromTeam.first_name} ${fromTeam.last_name}`,
            proposer_team: fromTeam.team_name
          },
          priority: 'high'
        });

        console.log(`Trade proposal notification sent to user ${toTeam.user_id} for trade ${tradeId}`);
      }
    } catch (error) {
      console.error('Error sending trade proposal notification:', error);
    }
  }

  static async notifyTradeStatusChanged(tradeId, status, notifyUserId, actorName = null) {
    try {
      let title, message, priority;
      
      switch (status) {
        case 'Accepted':
          title = 'Trade Accepted';
          message = actorName ? 
            `${actorName} has accepted your trade proposal` : 
            'Your trade proposal has been accepted';
          priority = 'medium';
          break;
        case 'Rejected':
          title = 'Trade Rejected';
          message = actorName ? 
            `${actorName} has rejected your trade proposal` : 
            'Your trade proposal has been rejected';
          priority = 'medium';
          break;
        case 'Completed':
          title = 'Trade Completed';
          message = 'Your trade has been processed and players have been transferred';
          priority = 'medium';
          break;
        default:
          return;
      }

      await Notification.create({
        userId: notifyUserId,
        type: 'trade',
        title,
        message,
        actionUrl: `/trades/${tradeId}`,
        metadata: {
          trade_id: tradeId,
          status: status.toLowerCase()
        },
        priority
      });

      console.log(`Trade ${status.toLowerCase()} notification sent to user ${notifyUserId}`);
    } catch (error) {
      console.error('Error sending trade status notification:', error);
    }
  }

  // WAIVER WIRE NOTIFICATIONS
  static async notifyWaiverProcessed(requestId, teamId, playerName, status, reason = null) {
    try {
      const [team] = await db.query(`
        SELECT u.user_id, ft.team_name
        FROM fantasy_teams ft 
        JOIN users u ON ft.user_id = u.user_id 
        WHERE ft.team_id = ?`, [teamId]);

      if (team) {
        const title = status === 'approved' ? 'Waiver Claim Approved' : 'Waiver Claim Rejected';
        const message = status === 'approved' ?
          `Your waiver claim for ${playerName} has been approved` :
          `Your waiver claim for ${playerName} was rejected${reason ? ': ' + reason : ''}`;

        await Notification.create({
          userId: team.user_id,
          type: 'waiver',
          title,
          message,
          actionUrl: '/waivers',
          metadata: {
            request_id: requestId,
            player_name: playerName,
            status,
            reason
          },
          priority: 'medium'
        });

        console.log(`Waiver ${status} notification sent to user ${team.user_id} for ${playerName}`);
      }
    } catch (error) {
      console.error('Error sending waiver notification:', error);
    }
  }

  // LEAGUE MANAGEMENT NOTIFICATIONS
  static async notifyLeagueAnnouncement(title, message, targetUsers = 'all', priority = 'medium') {
    try {
      let userQuery = 'SELECT user_id FROM users WHERE 1=1';
      const params = [];

      if (targetUsers !== 'all') {
        if (Array.isArray(targetUsers)) {
          userQuery += ` AND user_id IN (${targetUsers.map(() => '?').join(',')})`;
          params.push(...targetUsers);
        }
      }

      const users = await db.query(userQuery, params);

      const notifications = users.map(user => ({
        userId: user.user_id,
        type: 'league',
        title,
        message,
        actionUrl: '/message-board',
        metadata: {
          announcement_type: 'general',
          sent_at: new Date().toISOString()
        },
        priority
      }));

      if (notifications.length > 0) {
        await Notification.createBulk(notifications);
        console.log(`League announcement sent to ${notifications.length} users`);
      }
    } catch (error) {
      console.error('Error sending league announcement:', error);
    }
  }

  static async notifyRuleChange(changeDescription, effectiveDate = null) {
    try {
      const title = 'League Rule Change';
      const message = effectiveDate ?
        `${changeDescription}. Effective: ${effectiveDate}` :
        changeDescription;

      await this.notifyLeagueAnnouncement(title, message, 'all', 'high');
    } catch (error) {
      console.error('Error sending rule change notification:', error);
    }
  }

  static async notifyVotingRequired(topic, deadline = null) {
    try {
      const title = 'League Vote Required';
      const message = deadline ?
        `Please vote on: ${topic}. Voting closes: ${deadline}` :
        `Please vote on: ${topic}`;

      await this.notifyLeagueAnnouncement(title, message, 'all', 'high');
    } catch (error) {
      console.error('Error sending voting notification:', error);
    }
  }

  // WEEKLY GAME RESULTS NOTIFICATIONS
  static async notifyWeeklyResults(weekNumber, seasonYear = 2025) {
    try {
      // Get all teams and their performance for the week
      const results = await db.query(`
        SELECT 
          ft.team_id,
          ft.team_name,
          u.user_id,
          u.first_name,
          u.last_name,
          -- Add your scoring calculation here based on your scoring system
          0 as weekly_score,
          0 as season_total
        FROM fantasy_teams ft
        JOIN users u ON ft.user_id = u.user_id
        ORDER BY ft.team_name
      `);

      for (const team of results) {
        const message = `Week ${weekNumber} results: ${team.team_name} scored ${team.weekly_score} points`;
        
        await Notification.create({
          userId: team.user_id,
          type: 'league',
          title: `Week ${weekNumber} Results`,
          message,
          actionUrl: `/scoreboard?week=${weekNumber}`,
          metadata: {
            week_number: weekNumber,
            season_year: seasonYear,
            weekly_score: team.weekly_score,
            season_total: team.season_total
          },
          priority: 'low'
        });
      }

      console.log(`Weekly results notifications sent for Week ${weekNumber}`);
    } catch (error) {
      console.error('Error sending weekly results notifications:', error);
    }
  }

  static async notifyHighScore(weekNumber, teamId, score) {
    try {
      const [team] = await db.query(`
        SELECT ft.team_name, u.user_id, u.first_name, u.last_name
        FROM fantasy_teams ft 
        JOIN users u ON ft.user_id = u.user_id 
        WHERE ft.team_id = ?`, [teamId]);

      if (team) {
        await Notification.create({
          userId: team.user_id,
          type: 'league',
          title: '🏆 High Score of the Week!',
          message: `Congratulations! ${team.team_name} had the highest score in Week ${weekNumber} with ${score} points!`,
          actionUrl: `/scoreboard?week=${weekNumber}`,
          metadata: {
            achievement_type: 'high_score',
            week_number: weekNumber,
            score
          },
          priority: 'medium'
        });

        console.log(`High score notification sent to ${team.team_name} for Week ${weekNumber}`);
      }
    } catch (error) {
      console.error('Error sending high score notification:', error);
    }
  }

  // UTILITY FUNCTIONS FOR INTEGRATION
  static async notifyMultipleUsers(userIds, type, title, message, metadata = null, priority = 'medium') {
    try {
      const notifications = userIds.map(userId => ({
        userId,
        type,
        title,
        message,
        metadata,
        priority
      }));

      await Notification.createBulk(notifications);
      console.log(`Bulk notification sent to ${userIds.length} users: ${title}`);
    } catch (error) {
      console.error('Error sending bulk notifications:', error);
    }
  }
}

module.exports = NotificationTriggers;