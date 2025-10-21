class NotificationManager {
  constructor() {
    this.unreadCount = 0;
    this.notifications = [];
    this.isLoading = false;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadUnreadCount();
    
    // Poll less frequently - every 2 minutes instead of 30 seconds
    setInterval(() => {
      this.loadUnreadCount();
    }, 120000);
    
    // Also check when page becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.loadUnreadCount();
      }
    });
  }

  bindEvents() {
    const dropdown = document.getElementById('notificationsDropdown');
    const markAllBtn = document.getElementById('markAllReadBtn');

    if (dropdown) {
      dropdown.addEventListener('show.bs.dropdown', () => {
        this.loadNotifications();
      });
    }

    if (markAllBtn) {
      markAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.markAllAsRead();
      });
    }
  }

  async loadUnreadCount() {
    try {
      const response = await fetch('/api/notifications/unread-count', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        this.updateBadge(data.count);
      } else if (response.status === 401) {
        // User not authenticated, stop polling
        this.updateBadge(0);
        return;
      }
    } catch (error) {
      console.error('Error loading unread count:', error);
    }
  }

  async loadNotifications() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    const container = document.getElementById('notificationsList');
    
    try {
      const response = await fetch('/api/notifications?limit=10', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        this.notifications = data.notifications;
        this.renderNotifications(container, data.notifications);
        this.updateMarkAllButton(data.unreadCount);
      } else {
        this.renderError(container, 'Failed to load notifications');
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      this.renderError(container, 'Error loading notifications');
    } finally {
      this.isLoading = false;
    }
  }

  renderNotifications(container, notifications) {
    if (notifications.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted py-3">
          <i class="bi bi-bell-slash fs-4"></i>
          <div class="mt-2">No notifications</div>
        </div>
      `;
      return;
    }

    const notificationHtml = notifications.map(notification => {
      const timeAgo = this.formatTimeAgo(notification.created_at);
      const iconClass = this.getNotificationIcon(notification.type);
      const priorityClass = this.getPriorityClass(notification.priority);
      
      return `
        <div class="notification-item ${!notification.is_read ? 'unread' : ''} border-bottom pb-2 mb-2" 
             data-id="${notification.notification_id}">
          <div class="d-flex align-items-start">
            <div class="me-2 ${priorityClass}">
              <i class="bi ${iconClass}"></i>
            </div>
            <div class="flex-grow-1">
              <div class="fw-semibold small">${this.escapeHtml(notification.title)}</div>
              <div class="text-muted small">${this.escapeHtml(notification.message)}</div>
              <div class="text-muted" style="font-size: 0.75rem;">${timeAgo}</div>
            </div>
            <div class="dropdown">
              <button class="btn btn-sm btn-link text-muted" type="button" 
                      data-bs-toggle="dropdown" aria-expanded="false"
                      onclick="event.stopPropagation();">
                <i class="bi bi-three-dots"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                ${!notification.is_read ? 
                  `<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); event.stopPropagation(); notificationManager.markAsRead(${notification.notification_id}); return false;">
                     <i class="bi bi-check2"></i> Mark as read
                   </a></li>` : ''
                }
                <li><a class="dropdown-item text-danger" href="#" onclick="event.preventDefault(); event.stopPropagation(); notificationManager.deleteNotification(${notification.notification_id}); return false;">
                  <i class="bi bi-trash"></i> Delete
                </a></li>
              </ul>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = notificationHtml;
  }

  renderError(container, message) {
    container.innerHTML = `
      <div class="text-center text-danger py-3">
        <i class="bi bi-exclamation-triangle fs-4"></i>
        <div class="mt-2">${message}</div>
      </div>
    `;
  }

  updateBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count.toString();
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }
    this.unreadCount = count;
  }

  updateMarkAllButton(unreadCount) {
    const btn = document.getElementById('markAllReadBtn');
    if (btn) {
      if (unreadCount > 0) {
        btn.style.display = 'inline';
      } else {
        btn.style.display = 'none';
      }
    }
  }

  async markAsRead(notificationId) {
    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (response.ok) {
        const notificationElement = document.querySelector(`[data-id="${notificationId}"]`);
        if (notificationElement) {
          notificationElement.classList.remove('unread');
        }
        this.loadUnreadCount();
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }

  async markAllAsRead() {
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (response.ok) {
        document.querySelectorAll('.notification-item.unread').forEach(el => {
          el.classList.remove('unread');
        });
        this.updateBadge(0);
        this.updateMarkAllButton(0);
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }

  async deleteNotification(notificationId) {
    if (!confirm('Are you sure you want to delete this notification?')) {
      return;
    }

    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        const notificationElement = document.querySelector(`[data-id="${notificationId}"]`);
        if (notificationElement) {
          notificationElement.remove();
        }
        this.loadUnreadCount();
        
        const remaining = document.querySelectorAll('.notification-item').length;
        if (remaining === 0) {
          this.renderNotifications(document.getElementById('notificationsList'), []);
        }
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  }

  getNotificationIcon(type) {
    const icons = {
      trade: 'bi-arrow-left-right',
      draft: 'bi-trophy',
      waiver: 'bi-clipboard-check',
      league: 'bi-megaphone',
      player_update: 'bi-person-exclamation',
      keeper: 'bi-shield-check',
      system: 'bi-gear',
      message: 'bi-envelope'
    };
    return icons[type] || 'bi-info-circle';
  }

  getPriorityClass(priority) {
    const classes = {
      urgent: 'text-danger',
      high: 'text-warning',
      medium: 'text-info',
      low: 'text-muted'
    };
    return classes[priority] || 'text-muted';
  }

  formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

let notificationManager;

document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('notificationsDropdown')) {
    notificationManager = new NotificationManager();
  }
});
