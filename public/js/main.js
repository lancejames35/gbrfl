/**
 * Main JavaScript file for GBRFL Fantasy Football League
 */

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('GBRFL Fantasy Football application loaded');
    
    // Initialize any tooltips
    initializeTooltips();
    
    // Set up event listeners
    setupEventListeners();
    
    // Auto-hide flash messages after 5 seconds
    autoHideFlashMessages();
});

/**
 * Initialize Bootstrap tooltips
 */
function initializeTooltips() {
    // Check if Bootstrap is available
    if (typeof bootstrap !== 'undefined') {
        // Initialize all tooltips
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
        
        console.log('Tooltips initialized');
    }
}

/**
 * Set up various event listeners
 */
function setupEventListeners() {
    // Example: Add event listener to a logout button if it exists
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(event) {
            // Confirm before logout
            if (!confirm('Are you sure you want to log out?')) {
                event.preventDefault();
            }
        });
    }
    
    // Example: Form validation
    const forms = document.querySelectorAll('.needs-validation');
    if (forms.length > 0) {
        Array.from(forms).forEach(form => {
            form.addEventListener('submit', event => {
                if (!form.checkValidity()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                form.classList.add('was-validated');
            }, false);
        });
        
        console.log('Form validation initialized');
    }
}

/**
 * Auto-hide flash messages after a delay
 */
function autoHideFlashMessages() {
    const flashMessages = document.querySelectorAll('.alert:not(.alert-permanent)');
    
    if (flashMessages.length > 0) {
        setTimeout(() => {
            flashMessages.forEach(message => {
                // Create fade out effect
                message.style.transition = 'opacity 1s';
                message.style.opacity = '0';
                
                // Remove element after animation completes
                setTimeout(() => {
                    message.remove();
                }, 1000);
            });
        }, 5000); // 5 seconds delay
        
        console.log('Flash messages will auto-hide');
    }
}

/**
 * Helper function to format dates
 * @param {Date} date - The date to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
    if (!date) return '';
    
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    };
    
    return new Date(date).toLocaleDateString('en-US', options);
}