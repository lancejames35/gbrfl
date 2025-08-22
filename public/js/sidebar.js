document.addEventListener('DOMContentLoaded', function() {
    const sidebar = document.getElementById('sidebar');
    
    // If sidebar doesn't exist on this page (like login page), exit early
    if (!sidebar) return;
    
    // No longer using sidebarToggle in the header, so let's check for a mobile toggle button
    const sidebarToggle = document.getElementById('sidebar-toggle') || document.getElementById('mobile-menu-toggle');
    const sidebarPin = document.getElementById('sidebar-pin');
    const mainContent = document.querySelector('.main-content');
    
    // Check if we should start collapsed based on previous state
    function initSidebar() {
        // Start collapsed by default on desktop
        if (window.innerWidth >= 768) {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('collapsed');
            
            // Unless the user has explicitly chosen to keep it expanded
            if (localStorage.getItem('sidebarExpanded') === 'true') {
                sidebar.classList.remove('collapsed');
                mainContent.classList.remove('collapsed');
                sidebar.classList.add('pinned');
            }
        }
    }
    
    // Toggle sidebar on mobile
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.toggle('show');
        });
    }

    // Mobile close button
    const mobileCloseButton = document.getElementById('mobile-menu-close');
    if (mobileCloseButton) {
        mobileCloseButton.addEventListener('click', function() {
            sidebar.classList.remove('show');
        });
    }
    
    // Add mobile menu toggle to header if on mobile (only if we don't have one already)
    if (window.innerWidth < 768) {
        // Create mobile toggle if it doesn't exist
        if (!document.getElementById('mobile-menu-toggle')) {
            const mobileToggle = document.createElement('button');
            mobileToggle.id = 'mobile-menu-toggle';
            mobileToggle.className = 'btn btn-link text-white d-md-none';
            mobileToggle.innerHTML = '<i class="bi bi-list fs-4"></i>';
            mobileToggle.setAttribute('aria-label', 'Toggle menu');
            
            // Insert at start of header
            const header = document.querySelector('.main-header .container-fluid > div');
            if (header && header.firstChild) {
                header.insertBefore(mobileToggle, header.firstChild);
                
                // Add event listener
                mobileToggle.addEventListener('click', function() {
                    sidebar.classList.toggle('show');
                });
            }
        }
    }
    
    // Pin/unpin sidebar with the pin button
    if (sidebarPin) {
        sidebarPin.addEventListener('click', function() {
            const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
            
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('collapsed');
            sidebar.classList.toggle('pinned');
            
            // Remove hover effect when toggling
            sidebar.classList.remove('expanded-hover');
            mainContent.classList.remove('sidebar-hovered');
            
            // Save preference
            localStorage.setItem('sidebarExpanded', isCurrentlyCollapsed);
        });
    }
    
    // Show expanded sidebar on hover (desktop only)
    sidebar.addEventListener('mouseenter', function() {
        if (window.innerWidth >= 768 && sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('expanded-hover');
            mainContent.classList.add('sidebar-hovered');
        }
    });
    
    // Hide expanded sidebar when mouse leaves
    sidebar.addEventListener('mouseleave', function() {
        if (window.innerWidth >= 768) {
            sidebar.classList.remove('expanded-hover');
            mainContent.classList.remove('sidebar-hovered');
        }
    });
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', function(event) {
        if (window.innerWidth < 768 && sidebar) {
            const isClickInsideSidebar = sidebar.contains(event.target);
            const isClickOnToggle = sidebarToggle && sidebarToggle.contains(event.target);
            
            if (!isClickInsideSidebar && !isClickOnToggle && sidebar.classList.contains('show')) {
                sidebar.classList.remove('show');
            }
        }
    });
    
    // Update layout when window is resized
    window.addEventListener('resize', function() {
        if (!sidebar) return;
        
        if (window.innerWidth >= 768) {
            // Remove mobile classes
            sidebar.classList.remove('show');
            
            // Apply desktop classes based on saved preference
            if (localStorage.getItem('sidebarExpanded') === 'true') {
                sidebar.classList.remove('collapsed');
                mainContent.classList.remove('collapsed');
                sidebar.classList.add('pinned');
            } else {
                sidebar.classList.add('collapsed');
                mainContent.classList.add('collapsed');
                sidebar.classList.remove('pinned');
            }
        } else {
            // Remove desktop-only classes on mobile
            sidebar.classList.remove('expanded-hover', 'collapsed', 'pinned');
            mainContent.classList.remove('sidebar-hovered', 'collapsed');
        }
    });
    
    // Initialize sidebar state
    initSidebar();
});