document.addEventListener('DOMContentLoaded', function() {
  // Profile form
  const profileForm = document.getElementById('profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      await updateProfile();
    });
  }

  // Username form
  const usernameForm = document.getElementById('username-form');
  if (usernameForm) {
    usernameForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      await updateUsername();
    });
  }

  // Email form
  const emailForm = document.getElementById('email-form');
  if (emailForm) {
    emailForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      await updateEmail();
    });
  }

  // Password form
  const passwordForm = document.getElementById('password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      await updatePassword();
    });
  }

  // Password confirmation checking
  const newPasswordField = document.getElementById('newPassword');
  const confirmPasswordField = document.getElementById('confirmPassword');
  const passwordMatchDiv = document.getElementById('passwordMatch');

  if (newPasswordField && confirmPasswordField && passwordMatchDiv) {
    function checkPasswordMatch() {
      const newPassword = newPasswordField.value;
      const confirmPassword = confirmPasswordField.value;
      
      if (confirmPassword === '') {
        passwordMatchDiv.textContent = '';
        passwordMatchDiv.className = 'form-text';
        return;
      }
      
      if (newPassword === confirmPassword) {
        passwordMatchDiv.textContent = '✓ Passwords match';
        passwordMatchDiv.className = 'form-text text-success';
      } else {
        passwordMatchDiv.textContent = '✗ Passwords do not match';
        passwordMatchDiv.className = 'form-text text-danger';
      }
    }

    newPasswordField.addEventListener('input', checkPasswordMatch);
    confirmPasswordField.addEventListener('input', checkPasswordMatch);
  }

  // Notification settings
  const saveNotificationsBtn = document.getElementById('save-notifications');
  if (saveNotificationsBtn) {
    saveNotificationsBtn.addEventListener('click', async function() {
      await saveNotificationSettings();
    });
  }

  // Display settings
  const saveDisplayBtn = document.getElementById('save-display');
  if (saveDisplayBtn) {
    saveDisplayBtn.addEventListener('click', async function() {
      await saveDisplaySettings();
    });
  }

  // Privacy settings
  const savePrivacyBtn = document.getElementById('save-privacy');
  if (savePrivacyBtn) {
    savePrivacyBtn.addEventListener('click', async function() {
      await savePrivacySettings();
    });
  }

  // Auto-save notification preferences when toggles change
  const notificationToggles = document.querySelectorAll('input[data-type][data-method]');
  notificationToggles.forEach(toggle => {
    toggle.addEventListener('change', async function() {
      await updateNotificationPreference(this.dataset.type, this.dataset.method, this.checked);
    });
  });
});

async function updateProfile() {
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();

  if (!firstName || !lastName) {
    showAlert('Please enter both first and last name', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/auth/update-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ firstName, lastName })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Profile updated successfully!', 'success');
      // Update the displayed name in the header if needed
      setTimeout(() => location.reload(), 1500);
    } else {
      showAlert(result.error || 'Failed to update profile', 'danger');
    }
  } catch (error) {
    showAlert('Error updating profile', 'danger');
    console.error('Error:', error);
  }
}

async function updateUsername() {
  const newUsername = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('usernamePassword').value;

  if (!newUsername || !password) {
    showAlert('Please fill in all fields', 'warning');
    return;
  }

  if (newUsername.length < 3 || newUsername.length > 20) {
    showAlert('Username must be between 3 and 20 characters', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/preferences/username', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: newUsername, password })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Username updated successfully!', 'success');
      document.getElementById('newUsername').value = '';
      document.getElementById('usernamePassword').value = '';
      // Close the accordion
      const usernameAccordion = document.getElementById('changeUsername');
      const bsCollapse = new bootstrap.Collapse(usernameAccordion, { toggle: false });
      bsCollapse.hide();
      // Reload page to update displayed username
      setTimeout(() => location.reload(), 1500);
    } else {
      showAlert(result.error || 'Failed to update username', 'danger');
    }
  } catch (error) {
    showAlert('Error updating username', 'danger');
    console.error('Error:', error);
  }
}

async function updateEmail() {
  const newEmail = document.getElementById('newEmail').value;
  const password = document.getElementById('emailPassword').value;

  if (!newEmail || !password) {
    showAlert('Please fill in all fields', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/preferences/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: newEmail, password })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Email updated successfully!', 'success');
      document.getElementById('newEmail').value = '';
      document.getElementById('emailPassword').value = '';
      // Close the accordion
      const emailAccordion = document.getElementById('changeEmail');
      const bsCollapse = new bootstrap.Collapse(emailAccordion, { toggle: false });
      bsCollapse.hide();
      // Reload page to update displayed email
      setTimeout(() => location.reload(), 1500);
    } else {
      showAlert(result.error || 'Failed to update email', 'danger');
    }
  } catch (error) {
    showAlert('Error updating email', 'danger');
    console.error('Error:', error);
  }
}

async function updatePassword() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showAlert('Please fill in all fields', 'warning');
    return;
  }

  if (newPassword !== confirmPassword) {
    showAlert('New passwords do not match', 'warning');
    return;
  }

  if (newPassword.length < 6) {
    showAlert('New password must be at least 6 characters', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/preferences/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ 
        currentPassword, 
        newPassword, 
        confirmPassword 
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Password changed successfully!', 'success');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('passwordMatch').textContent = '';
      // Close the accordion
      const passwordAccordion = document.getElementById('changePassword');
      const bsCollapse = new bootstrap.Collapse(passwordAccordion, { toggle: false });
      bsCollapse.hide();
    } else {
      showAlert(result.error || 'Failed to change password', 'danger');
    }
  } catch (error) {
    showAlert('Error changing password', 'danger');
    console.error('Error:', error);
  }
}

async function updateNotificationPreference(type, method, enabled) {
  try {
    const response = await fetch('/api/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        actionType: type,
        emailEnabled: method === 'email' ? enabled : undefined,
        siteEnabled: method === 'site' ? enabled : undefined
      })
    });

    if (!response.ok) {
      const result = await response.json();
      showAlert(result.error || 'Failed to update notification preference', 'warning');
    }
  } catch (error) {
    showAlert('Error updating notification preference', 'danger');
    console.error('Error:', error);
  }
}

async function saveNotificationSettings() {
  const preferences = {
    notifications: {
      digest_frequency: document.getElementById('digestFrequency').value,
      quiet_hours_enabled: document.getElementById('quietHours').checked,
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00'
    }
  };

  try {
    const response = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preferences })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Notification settings saved!', 'success');
    } else {
      showAlert(result.error || 'Failed to save settings', 'danger');
    }
  } catch (error) {
    showAlert('Error saving notification settings', 'danger');
    console.error('Error:', error);
  }
}

async function saveDisplaySettings() {
  const preferences = {
    theme: document.querySelector('input[name="theme"]:checked').value,
    display: {
      table_density: document.getElementById('tableDensity').value,
      items_per_page: parseInt(document.getElementById('itemsPerPage').value),
      show_player_images: true,
      default_sort: 'rank'
    }
  };

  try {
    const response = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preferences })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Display settings saved!', 'success');
    } else {
      showAlert(result.error || 'Failed to save settings', 'danger');
    }
  } catch (error) {
    showAlert('Error saving display settings', 'danger');
    console.error('Error:', error);
  }
}

async function savePrivacySettings() {
  const preferences = {
    privacy: {
      profile_public: document.getElementById('profilePublic').checked,
      show_trade_block: document.getElementById('showTradeBlock').checked,
      show_activity: document.getElementById('showActivity').checked
    }
  };

  try {
    const response = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preferences })
    });

    const result = await response.json();
    
    if (response.ok) {
      showAlert('Privacy settings saved!', 'success');
    } else {
      showAlert(result.error || 'Failed to save settings', 'danger');
    }
  } catch (error) {
    showAlert('Error saving privacy settings', 'danger');
    console.error('Error:', error);
  }
}

function showAlert(message, type = 'info') {
  // Remove any existing alerts
  const existingAlert = document.querySelector('.settings-alert');
  if (existingAlert) {
    existingAlert.remove();
  }

  // Create new alert
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} alert-dismissible fade show settings-alert`;
  alert.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;

  // Insert at the top of the page
  const container = document.querySelector('.container-fluid');
  container.insertBefore(alert, container.firstChild);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (alert && alert.parentNode) {
      alert.remove();
    }
  }, 5000);
}

function cancelUsernameChange() {
  document.getElementById('newUsername').value = '';
  document.getElementById('usernamePassword').value = '';
  const usernameAccordion = document.getElementById('changeUsername');
  const bsCollapse = new bootstrap.Collapse(usernameAccordion, { toggle: false });
  bsCollapse.hide();
}

function cancelEmailChange() {
  document.getElementById('newEmail').value = '';
  document.getElementById('emailPassword').value = '';
  const emailAccordion = document.getElementById('changeEmail');
  const bsCollapse = new bootstrap.Collapse(emailAccordion, { toggle: false });
  bsCollapse.hide();
}

function cancelPasswordChange() {
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('passwordMatch').textContent = '';
  const passwordAccordion = document.getElementById('changePassword');
  const bsCollapse = new bootstrap.Collapse(passwordAccordion, { toggle: false });
  bsCollapse.hide();
}