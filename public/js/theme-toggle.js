// Theme toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;
    
    // Check if user has previously set a theme preference
    const savedTheme = localStorage.getItem('gbrfl-theme');
    if (savedTheme === 'retro') {
      body.classList.add('retro-theme');
      updateToggleButton(true);
    }
    
    // Toggle theme when button is clicked
    if (themeToggle) {
      themeToggle.addEventListener('click', function() {
        // Toggle the theme class on body
        body.classList.toggle('retro-theme');
        
        // Save preference to localStorage
        const isRetro = body.classList.contains('retro-theme');
        localStorage.setItem('gbrfl-theme', isRetro ? 'retro' : 'modern');
        
        // Update button text
        updateToggleButton(isRetro);
      });
    }
    
    // Update the toggle button text based on current theme
    function updateToggleButton(isRetro) {
      if (themeToggle) {
        const iconSpan = themeToggle.querySelector('i');
        const textSpan = themeToggle.querySelector('span');
        
        if (isRetro) {
          if (iconSpan) iconSpan.className = 'bi bi-display me-2';
          if (textSpan) textSpan.textContent = 'Modern Theme';
        } else {
          if (iconSpan) iconSpan.className = 'bi bi-newspaper me-2';
          if (textSpan) textSpan.textContent = 'Retro Theme';
        }
      }
    }
  });