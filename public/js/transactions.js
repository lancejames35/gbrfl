/**
 * GBRFL Transactions JavaScript
 * Handles filtering, loading, and displaying transaction data
 */

document.addEventListener('DOMContentLoaded', function() {
  // Cache DOM elements
  const transactionsContainer = document.getElementById('transactionsContainer');
  const seasonFilter = document.getElementById('seasonFilter');
  const weekFilter = document.getElementById('weekFilter');
  const ownerFilter = document.getElementById('ownerFilter');
  const typeFilter = document.getElementById('typeFilter');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const resetFiltersBtn = document.getElementById('resetFilters');
  const paginationContainer = document.getElementById('paginationContainer');
  
  // Templates
  const transactionTemplate = document.getElementById('transactionTemplate');
  const weekHeaderTemplate = document.getElementById('weekHeaderTemplate');
  const seasonHeaderTemplate = document.getElementById('seasonHeaderTemplate');
  
  // State
  let currentPage = 1;
  const itemsPerPage = 20;
  let totalPages = 1;
  
  // Initialize
  loadTransactions();
  
  // Event listeners
  applyFiltersBtn.addEventListener('click', function() {
    currentPage = 1;
    loadTransactions();
  });
  
  resetFiltersBtn.addEventListener('click', function() {
    seasonFilter.value = 'all';
    weekFilter.value = 'all';
    ownerFilter.value = 'all';
    typeFilter.value = 'all';
    currentPage = 1;
    loadTransactions();
  });
  
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('page-link')) {
      e.preventDefault();
      
      if (e.target.classList.contains('prev-page')) {
        if (currentPage > 1) {
          currentPage--;
          loadTransactions();
        }
      } else if (e.target.classList.contains('next-page')) {
        if (currentPage < totalPages) {
          currentPage++;
          loadTransactions();
        }
      } else if (e.target.dataset.page) {
        currentPage = parseInt(e.target.dataset.page);
        loadTransactions();
      }
    }
  });
  
  /**
   * Loads transaction data based on filters
   */
  function loadTransactions() {
    // Show loading state
    transactionsContainer.innerHTML = `
      <div class="loading">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <p>Loading transactions...</p>
      </div>
    `;
    
    // Build query params
    const params = new URLSearchParams();
    params.append('page', currentPage);
    params.append('itemsPerPage', itemsPerPage);
    
    if (seasonFilter.value !== 'all') {
      params.append('season', seasonFilter.value);
    }
    
    if (weekFilter.value !== 'all') {
      params.append('week', weekFilter.value);
    }
    
    if (ownerFilter.value !== 'all') {
      params.append('owner', ownerFilter.value);
    }
    
    if (typeFilter.value !== 'all') {
      params.append('type', typeFilter.value);
    }
    
    // Fetch transactions with filters
    fetch(`/api/transactions?${params.toString()}`)
      .then(response => response.json())
      .then(data => {
        displayTransactions(data.transactions);
        updatePagination(data.totalItems);
      })
      .catch(error => {
        console.error('Error fetching transactions:', error);
        transactionsContainer.innerHTML = `
          <div class="alert alert-danger" role="alert">
            Error loading transactions. Please try again later.
          </div>
        `;
      });
  }
  
  /**
   * Displays transaction data in the UI
   * @param {Array} transactions - Array of transaction objects
   */
  function displayTransactions(transactions) {
    // Clear container
    transactionsContainer.innerHTML = '';
    
    if (transactions.length === 0) {
      transactionsContainer.innerHTML = `
        <div class="no-results">
          <i class="bi bi-search" style="font-size: 2rem;"></i>
          <p>No transactions found with the selected filters.</p>
        </div>
      `;
      return;
    }
    
    // Group transactions by season and week
    const grouped = groupTransactions(transactions);
    
    // Display transactions grouped by season and week
    Object.keys(grouped).sort((a, b) => b - a).forEach(season => {
      // Add season header
      const seasonHeader = seasonHeaderTemplate.content.cloneNode(true);
      seasonHeader.querySelector('h3').textContent = `${season} Season`;
      transactionsContainer.appendChild(seasonHeader);
      
      // For each week in the season
      Object.keys(grouped[season]).sort((a, b) => {
        // Custom sort for weeks (Offseason first, then Draft, then numbered weeks)
        if (a === 'Offseason') return -1;
        if (b === 'Offseason') return 1;
        if (a === 'Draft') return -1;
        if (b === 'Draft') return 1;
        
        // Extract week number and compare
        const numA = parseInt(a.replace('Week ', ''));
        const numB = parseInt(b.replace('Week ', ''));
        return numB - numA;
      }).forEach(week => {
        // Add week header
        const weekHeader = weekHeaderTemplate.content.cloneNode(true);
        weekHeader.querySelector('.week-header').textContent = week;
        transactionsContainer.appendChild(weekHeader);
        
        // Add transactions for this week
        grouped[season][week].forEach(transaction => {
          renderTransaction(transaction);
        });
      });
    });
  }
  
  /**
   * Groups transactions by season and week
   * @param {Array} transactions - Array of transaction objects
   * @returns {Object} - Nested object grouped by season and week
   */
  function groupTransactions(transactions) {
    const grouped = {};
    
    transactions.forEach(transaction => {
      const season = transaction.season_year;
      const week = transaction.week;
      
      if (!grouped[season]) {
        grouped[season] = {};
      }
      
      if (!grouped[season][week]) {
        grouped[season][week] = [];
      }
      
      grouped[season][week].push(transaction);
    });
    
    return grouped;
  }
  
  /**
   * Renders a single transaction row
   * @param {Object} transaction - Transaction object
   */
  function renderTransaction(transaction) {
    const transactionRow = transactionTemplate.content.cloneNode(true);
    
    // Set owner name
    transactionRow.querySelector('.owner-name').textContent = transaction.owner_name;
    
    // Set acquired items
    const acquiredEl = transactionRow.querySelector('.acquired');
    if (transaction.acquired) {
      acquiredEl.textContent = '+ ' + transaction.acquired;
      acquiredEl.classList.add('acquired');
      
      // Add conditional styling if needed
      if (transaction.is_conditional) {
        acquiredEl.classList.add('conditional-trade');
      }
    } else {
      acquiredEl.parentNode.textContent = ''; // Hide if empty
    }
    
    // Set lost items
    const lostEl = transactionRow.querySelector('.lost');
    if (transaction.lost) {
      lostEl.textContent = '− ' + transaction.lost;
      lostEl.classList.add('lost');
      
      // Add conditional styling if needed
      if (transaction.is_conditional) {
        lostEl.classList.add('conditional-trade');
      }
    } else {
      lostEl.parentNode.textContent = ''; // Hide if empty
    }
    
    // Set date (format: Apr 14)
    const date = new Date(transaction.transaction_date);
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    transactionRow.querySelector('.transaction-date').textContent = formattedDate;
    
    // Append to container
    transactionsContainer.appendChild(transactionRow);
  }
  
  /**
   * Updates pagination based on total items
   * @param {number} totalItems - Total number of transactions
   */
  function updatePagination(totalItems) {
    totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalPages <= 1) {
      paginationContainer.classList.add('d-none');
      return;
    }
    
    paginationContainer.classList.remove('d-none');
    
    // Build pagination links
    const paginationList = paginationContainer.querySelector('.pagination');
    paginationList.innerHTML = '';
    
    // Previous button
    const prevItem = document.createElement('li');
    prevItem.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevItem.innerHTML = `
      <a class="page-link prev-page" href="#" ${currentPage === 1 ? 'tabindex="-1" aria-disabled="true"' : ''}>Previous</a>
    `;
    paginationList.appendChild(prevItem);
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
      const pageItem = document.createElement('li');
      pageItem.className = `page-item ${i === currentPage ? 'active' : ''}`;
      pageItem.innerHTML = `<a class="page-link" data-page="${i}" href="#">${i}</a>`;
      paginationList.appendChild(pageItem);
    }
    
    // Next button
    const nextItem = document.createElement('li');
    nextItem.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextItem.innerHTML = `
      <a class="page-link next-page" href="#" ${currentPage === totalPages ? 'tabindex="-1" aria-disabled="true"' : ''}>Next</a>
    `;
    paginationList.appendChild(nextItem);
  }
});