/**
 * Scoreboard JavaScript
 * Handles interactive functionality for the fantasy football scoreboard
 */

// Global variables
let currentGameId = null;
let autoRefreshInterval = null;
let isLiveGame = false;

// Initialize scoreboard functionality
document.addEventListener('DOMContentLoaded', function() {
    initializeScoreboard();
    setupEventListeners();
    startPeriodicUpdates();
});

/**
 * Initialize scoreboard components
 */
function initializeScoreboard() {
    // Add fade-in animation to main content
    const container = document.querySelector('.scoreboard-container');
    if (container) {
        container.classList.add('fade-in');
    }

    // Initialize category sections as collapsed by default
    const categoryContents = document.querySelectorAll('.category-content');
    categoryContents.forEach(content => {
        content.style.display = 'none';
    });

    // Set up mobile swipe detection
    if (window.innerWidth < 992) {
        initializeMobileSwipe();
    }

    // Check for live games
    checkForLiveGames();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Window resize handler
    window.addEventListener('resize', handleResize);

    // Category expand/collapse handlers
    document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', function() {
            const category = this.closest('.category-section').dataset.category;
            toggleCategory(category);
        });
    });

    // Player breakdown toggle handlers
    document.querySelectorAll('[onclick*="togglePlayerBreakdown"]').forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            const category = this.getAttribute('onclick').match(/'([^']+)'/)[1];
            togglePlayerBreakdown(category);
        });
    });

    // Mobile category handlers
    document.querySelectorAll('[onclick*="toggleMobileCategory"]').forEach(header => {
        header.addEventListener('click', function() {
            const category = this.getAttribute('onclick').match(/'([^']+)'/)[1];
            toggleMobileCategory(category);
        });
    });

    // Game navigation handlers
    document.querySelectorAll('.game-card').forEach(card => {
        card.addEventListener('click', function() {
            const gameId = this.getAttribute('onclick').match(/\d+/)[0];
            navigateToGame(gameId);
        });
    });
}

/**
 * Handle window resize events
 */
function handleResize() {
    const isMobile = window.innerWidth < 992;
    
    if (isMobile && !document.querySelector('.mobile-scoreboard')) {
        // Switched to mobile - reinitialize mobile components
        initializeMobileSwipe();
    } else if (!isMobile && document.querySelector('.mobile-scoreboard')) {
        // Switched to desktop - cleanup mobile components
        cleanupMobileSwipe();
    }
}

/**
 * Toggle category section visibility
 */
function toggleCategory(category) {
    const content = document.getElementById(category + '-content');
    const section = document.querySelector(`[data-category="${category}"]`);
    const icon = section.querySelector('.expand-icon');
    
    if (!content || !icon) return;
    
    const isHidden = content.style.display === 'none' || content.style.display === '';
    
    if (isHidden) {
        content.style.display = 'block';
        content.classList.add('fade-in');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
        
        // Update button text
        const button = section.querySelector('.expand-btn');
        if (button) {
            button.innerHTML = '<i class="fas fa-chevron-up expand-icon"></i> Collapse';
        }
    } else {
        content.style.display = 'none';
        content.classList.remove('fade-in');
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
        
        // Update button text
        const button = section.querySelector('.expand-btn');
        if (button) {
            button.innerHTML = '<i class="fas fa-chevron-down expand-icon"></i> Details';
        }
    }
}

/**
 * Toggle player breakdown visibility
 */
function togglePlayerBreakdown(category) {
    const breakdown = document.getElementById(category + '-players');
    const button = breakdown.parentNode.querySelector('button[onclick*="togglePlayerBreakdown"]');
    
    if (!breakdown || !button) return;
    
    const isHidden = breakdown.style.display === 'none' || breakdown.style.display === '';
    
    if (isHidden) {
        breakdown.style.display = 'block';
        breakdown.classList.add('fade-in');
        button.innerHTML = '<i class="fas fa-users"></i> Hide Player Breakdown';
    } else {
        breakdown.style.display = 'none';
        breakdown.classList.remove('fade-in');
        button.innerHTML = '<i class="fas fa-users"></i> Show Player Breakdown';
    }
}

/**
 * Mobile swipe functionality
 */
let touchStartX = 0;
let touchEndX = 0;
let currentTeam = 1;

function initializeMobileSwipe() {
    const container = document.getElementById('teamContainer');
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    
    // Initialize with team 1
    showTeam(1);
}

function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
}

function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture();
}

function handleSwipeGesture() {
    const swipeThreshold = 50;
    const difference = touchStartX - touchEndX;
    
    if (Math.abs(difference) > swipeThreshold) {
        if (difference > 0 && currentTeam === 1) {
            // Swipe left - show team 2
            showTeam(2);
        } else if (difference < 0 && currentTeam === 2) {
            // Swipe right - show team 1
            showTeam(1);
        }
    }
}

function showTeam(teamNumber) {
    if (teamNumber === currentTeam) return;
    
    currentTeam = teamNumber;
    
    // Hide all team displays
    document.querySelectorAll('.team-display').forEach(display => {
        display.style.display = 'none';
        display.classList.remove('slide-in-left', 'slide-in-right');
    });
    
    // Show selected team with animation
    const teamDisplay = document.getElementById(`team${teamNumber}-display`);
    if (teamDisplay) {
        teamDisplay.style.display = 'block';
        teamDisplay.classList.add(teamNumber === 1 ? 'slide-in-right' : 'slide-in-left');
    }
    
    // Update indicators
    document.querySelectorAll('.team-dot').forEach(dot => {
        dot.classList.remove('active');
    });
    
    const activeDot = document.getElementById(`team${teamNumber}-dot`);
    if (activeDot) {
        activeDot.classList.add('active');
    }
}

function cleanupMobileSwipe() {
    const container = document.getElementById('teamContainer');
    if (container) {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchend', handleTouchEnd);
    }
}

/**
 * Mobile category toggle
 */
function toggleMobileCategory(category) {
    const content = document.getElementById(`mobile-${category}-content`);
    const header = document.querySelector(`[onclick*="toggleMobileCategory('${category}')"]`);
    const icon = header.querySelector('.expand-icon');
    
    if (!content || !icon) return;
    
    const isHidden = content.style.display === 'none' || content.style.display === '';
    
    if (isHidden) {
        content.style.display = 'block';
        content.classList.add('fade-in');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    } else {
        content.style.display = 'none';
        content.classList.remove('fade-in');
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    }
}

/**
 * Show mobile player details in modal
 */
function showMobilePlayerDetails(category) {
    const modal = new bootstrap.Modal(document.getElementById('mobilePlayerModal'));
    const title = document.getElementById('mobilePlayerModalTitle');
    const body = document.getElementById('mobilePlayerModalBody');
    
    if (!modal || !title || !body) return;
    
    title.textContent = `${category.charAt(0).toUpperCase() + category.slice(1)} Player Details`;
    
    // Generate player details content
    const playersHtml = generateMobilePlayerContent(category);
    body.innerHTML = playersHtml;
    
    modal.show();
}

function generateMobilePlayerContent(category) {
    // This would be dynamically generated based on the category and current game data
    // For now, return a structured placeholder
    return `
        <div class="mobile-player-details">
            <div class="row mb-3">
                <div class="col-12">
                    <h6 class="text-primary">${category.charAt(0).toUpperCase() + category.slice(1)} Player Breakdown</h6>
                </div>
            </div>
            
            <div class="row">
                <div class="col-6">
                    <h6 class="text-center">Team 1</h6>
                    <div class="player-list">
                        <div class="card mb-2">
                            <div class="card-body py-2">
                                <small class="text-muted">Player data loading...</small>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <h6 class="text-center">Team 2</h6>
                    <div class="player-list">
                        <div class="card mb-2">
                            <div class="card-body py-2">
                                <small class="text-muted">Player data loading...</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Navigation functions
 */
function navigateToWeek(week) {
    if (week >= 1 && week <= 18) {
        const gameType = getSelectedGameType();
        window.location.href = `/scoreboard/week/${week}/${gameType}`;
    }
}

function switchGameType(type) {
    const currentWeek = getCurrentWeek();
    window.location.href = `/scoreboard/week/${currentWeek}/${type}`;
}

function navigateToGame(gameId) {
    window.location.href = `/scoreboard/game/${gameId}`;
}

function getSelectedGameType() {
    // Get from server data if available, otherwise from DOM
    if (window.scoreboardData && window.scoreboardData.gameType) {
        return window.scoreboardData.gameType;
    }
    const activeButton = document.querySelector('.game-type-tabs .btn.active');
    return activeButton ? activeButton.textContent.toLowerCase() : 'primary';
}

function getCurrentWeek() {
    // Get from server data if available, otherwise from DOM
    if (window.scoreboardData && window.scoreboardData.currentWeek) {
        return window.scoreboardData.currentWeek;
    }
    const weekElement = document.querySelector('.week-navigation h4');
    if (weekElement) {
        const match = weekElement.textContent.match(/Week (\d+)/);
        return match ? parseInt(match[1]) : 1;
    }
    return 1;
}

/**
 * Live updates functionality
 */
function checkForLiveGames() {
    // Check if any games are currently live
    const badges = document.querySelectorAll('.badge');
    let hasLiveGames = false;
    
    badges.forEach(badge => {
        if (badge.textContent.includes('LIVE')) {
            hasLiveGames = true;
        }
    });
    
    isLiveGame = hasLiveGames;
    
    if (isLiveGame) {
        startAutoRefresh();
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Refresh every 30 seconds for live games
    autoRefreshInterval = setInterval(() => {
        refreshLiveData();
    }, 30000);
    
    console.log('Auto-refresh started for live games');
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    console.log('Auto-refresh stopped');
}

function refreshLiveData() {
    if (!currentGameId) return;
    
    // Show loading indicator
    showLoadingIndicator();
    
    // Fetch updated game data
    fetch(`/scoreboard/api/live/${currentGameId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateGameDisplay(data.game);
                console.log('Live data updated:', new Date().toLocaleTimeString());
            }
        })
        .catch(error => {
            console.error('Error refreshing live data:', error);
        })
        .finally(() => {
            hideLoadingIndicator();
        });
}

function updateGameDisplay(gameData) {
    // Update scores
    updateScores(gameData);
    
    // Update player stats
    updatePlayerStats(gameData);
    
    // Update category winners
    updateCategoryWinners(gameData);
    
    // Trigger animations for updated elements
    animateUpdatedElements();
}

function updateScores(gameData) {
    // Update team scores
    const team1Score = document.querySelector('.team1 .total-score');
    const team2Score = document.querySelector('.team2 .total-score');
    
    if (team1Score) team1Score.textContent = gameData.team1.totalScore;
    if (team2Score) team2Score.textContent = gameData.team2.totalScore;
}

function updatePlayerStats(gameData) {
    // Update individual player statistics
    // This would iterate through players and update their displayed stats
    console.log('Updating player stats...');
}

function updateCategoryWinners(gameData) {
    // Update category winner indicators
    console.log('Updating category winners...');
}

function animateUpdatedElements() {
    // Add pulse animation to updated elements
    const updatedElements = document.querySelectorAll('.updated');
    updatedElements.forEach(element => {
        element.classList.add('pulse');
        setTimeout(() => {
            element.classList.remove('pulse', 'updated');
        }, 1000);
    });
}

function showLoadingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'liveUpdateIndicator';
    indicator.className = 'position-fixed top-0 end-0 m-3 alert alert-info d-flex align-items-center';
    indicator.innerHTML = '<div class="loading-spinner me-2"></div>Updating live data...';
    document.body.appendChild(indicator);
}

function hideLoadingIndicator() {
    const indicator = document.getElementById('liveUpdateIndicator');
    if (indicator) {
        indicator.remove();
    }
}

/**
 * Periodic updates for non-live content
 */
function startPeriodicUpdates() {
    // Check for live games every 2 minutes
    setInterval(() => {
        checkForLiveGames();
    }, 120000);
}

/**
 * Utility functions
 */
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
}

function formatPlayerName(firstName, lastName) {
    return `${firstName} ${lastName}`;
}

function getPositionColor(position) {
    const colors = {
        'QB': '#ff6b6b',
        'RB': '#feca57', 
        'WR': '#48dbfb',
        'TE': '#48dbfb',
        'K': '#1dd1a1',
        'DEF': '#a55eea'
    };
    return colors[position] || '#6c757d';
}

/**
 * Cleanup function
 */
function cleanup() {
    stopAutoRefresh();
    cleanupMobileSwipe();
}

// Cleanup when leaving the page
window.addEventListener('beforeunload', cleanup);

// Export functions for global access
window.ScoreboardJS = {
    toggleCategory,
    togglePlayerBreakdown,
    toggleMobileCategory,
    showMobilePlayerDetails,
    navigateToWeek,
    switchGameType,
    navigateToGame,
    showTeam
};