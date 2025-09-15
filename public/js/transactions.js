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
  const resetFiltersBtn = document.getElementById('resetFilters');
  const paginationContainer = document.getElementById('paginationContainer');
  
  // Templates
  const transactionTemplate = document.getElementById('transactionTemplate');
  const competitorTemplate = document.getElementById('competitorTemplate');
  const weekHeaderTemplate = document.getElementById('weekHeaderTemplate');
  const seasonHeaderTemplate = document.getElementById('seasonHeaderTemplate');
  
  // State
  let currentPage = 1;
  const itemsPerPage = 50;
  let totalPages = 1;
  
  // Initialize
  loadTransactions();
  
  // Event listeners for auto-updating filters
  seasonFilter.addEventListener('change', function() {
    currentPage = 1;
    loadTransactions();
  });

  weekFilter.addEventListener('change', function() {
    currentPage = 1;
    loadTransactions();
  });

  ownerFilter.addEventListener('change', function() {
    currentPage = 1;
    loadTransactions();
  });

  typeFilter.addEventListener('change', function() {
    currentPage = 1;
    loadTransactions();
  });

  resetFiltersBtn.addEventListener('click', function() {
    seasonFilter.value = '2025';
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
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Received data:', data);
        if (data.status === 'success' && data.transactions) {
          displayTransactions(data.transactions);
          updatePagination(data.totalItems);
        } else {
          throw new Error(data.message || 'Unknown error');
        }
      })
      .catch(error => {
        console.error('Error fetching transactions:', error);
        transactionsContainer.innerHTML = `
          <div class="alert alert-danger" role="alert">
            Error loading transactions: ${error.message}. Please try again later.
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

    // Add header row
    const headerRow = document.createElement('div');
    headerRow.className = 'transaction-header row fw-bold border-bottom pb-2 mb-3';
    headerRow.innerHTML = `
      <div class="col-md-3">Team/Owner</div>
      <div class="col-md-2">Type</div>
      <div class="col-md-3">Acquired</div>
      <div class="col-md-3">Traded/Dropped</div>
      <div class="col-md-1"></div>
    `;
    transactionsContainer.appendChild(headerRow);

    // Group transactions by week
    const grouped = groupTransactions(transactions);

    // Display transactions grouped by week (most recent first)
    Object.keys(grouped).sort((a, b) => {
      // Custom sort for weeks (higher numbered weeks first)
      if (a === 'Offseason') return 1;
      if (b === 'Offseason') return -1;
      if (a === 'Draft') return 1;
      if (b === 'Draft') return -1;

      // Extract week number and compare (descending)
      const numA = parseInt(a.replace('Week ', ''));
      const numB = parseInt(b.replace('Week ', ''));
      return numB - numA;
    }).forEach(week => {
      // Add week header
      const weekHeader = weekHeaderTemplate.content.cloneNode(true);
      weekHeader.querySelector('.week-header').textContent = week;
      transactionsContainer.appendChild(weekHeader);

      // Add transactions for this week
      grouped[week].forEach(transaction => {
        renderTransaction(transaction);
      });
    });
  }
  
  /**
   * Groups transactions by week
   * @param {Array} transactions - Array of transaction objects
   * @returns {Object} - Object grouped by week
   */
  function groupTransactions(transactions) {
    const grouped = {};

    transactions.forEach(transaction => {
      const week = transaction.week;

      if (!grouped[week]) {
        grouped[week] = [];
      }

      grouped[week].push(transaction);
    });

    return grouped;
  }
  
  /**
   * Renders a single transaction row
   * @param {Object} transaction - Transaction object
   */
  function renderTransaction(transaction) {
    const transactionRow = transactionTemplate.content.cloneNode(true);
    const mainRow = transactionRow.querySelector('.transaction-row');

    // Set request ID for reference
    mainRow.setAttribute('data-request-id', transaction.request_id);

    // Set team and owner name
    transactionRow.querySelector('.owner-name').innerHTML = `
      <strong>${transaction.team_name}</strong><br>
      <small class="text-muted">${transaction.first_name} ${transaction.last_name}</small>
    `;

    // Set transaction type
    const typeEl = transactionRow.querySelector('.transaction-type');
    typeEl.textContent = `Waiver Wire (${transaction.waiver_round} Round)`;

    // Set acquired player
    const acquiredEl = transactionRow.querySelector('.acquired');
    acquiredEl.textContent = `${transaction.pickup_name} (${transaction.pickup_position})`;

    // Set dropped player
    const lostEl = transactionRow.querySelector('.lost');
    lostEl.textContent = `${transaction.drop_name} (${transaction.drop_position})`;

    // Handle competitors (show expand button if there are competitors)
    const expandBtn = transactionRow.querySelector('.expand-btn');
    const competitorsSection = transactionRow.querySelector('.competitors-section');

    console.log(`Transaction ${transaction.request_id} has ${transaction.competitors ? transaction.competitors.length : 0} competitors`);

    if (transaction.competitors && transaction.competitors.length > 0) {
      console.log(`Showing expand button for transaction ${transaction.request_id}`);
      expandBtn.classList.remove('d-none');
      expandBtn.setAttribute('title', `${transaction.competitors.length} other team(s) also wanted this player`);

      // Add click handler for expand button
      expandBtn.addEventListener('click', function() {
        const isExpanded = !competitorsSection.classList.contains('d-none');

        if (isExpanded) {
          // Collapse
          competitorsSection.classList.add('d-none');
          expandBtn.querySelector('i').className = 'bi bi-chevron-down';
        } else {
          // Expand
          competitorsSection.classList.remove('d-none');
          expandBtn.querySelector('i').className = 'bi bi-chevron-up';

          // Populate competitors if not already done
          const competitorsList = competitorsSection.querySelector('.competitors-list');
          if (competitorsList.children.length === 0) {
            transaction.competitors.forEach(competitor => {
              renderCompetitor(competitor, competitorsList, transaction);
            });
          }
        }
      });
    } else {
      console.log(`No competitors for transaction ${transaction.request_id}`);
    }

    // Append to container
    transactionsContainer.appendChild(transactionRow);
  }

  /**
   * Renders a competitor row
   * @param {Object} competitor - Competitor object
   * @param {Element} container - Container to append to
   * @param {Object} winningTransaction - The transaction that won
   */
  function renderCompetitor(competitor, container, winningTransaction) {
    const competitorRow = competitorTemplate.content.cloneNode(true);

    // Set competitor name
    competitorRow.querySelector('.competitor-name').textContent = competitor.team_name;

    // Create story based on waiver positions
    const storyEl = competitorRow.querySelector('.competitor-story');
    const winnerPosition = winningTransaction.waiver_order_position;
    const loserPosition = competitor.waiver_order_position;
    const positionDiff = Math.abs(winnerPosition - loserPosition);

    let story = '';

    if (winnerPosition < loserPosition) {
      // Winner had higher priority (lower number)
      if (positionDiff === 1) {
        story = `Lost by <span class="text-danger">1 waiver position</span> to ${winningTransaction.team_name} (${winnerPosition} vs ${loserPosition})`;
      } else if (positionDiff <= 3) {
        story = `Lost by <span class="text-warning">${positionDiff} waiver positions</span> to ${winningTransaction.team_name} (${winnerPosition} vs ${loserPosition})`;
      } else {
        story = `Lost by <span class="text-danger">${positionDiff} waiver positions</span> to ${winningTransaction.team_name} (${winnerPosition} vs ${loserPosition})`;
      }
    } else {
      // This happens when team had higher priority but already used their pick this round
      story = `Had higher priority but already used their pick this round. Lost to ${winningTransaction.team_name} (${winnerPosition} vs ${loserPosition})`;
    }

    storyEl.innerHTML = story;

    container.appendChild(competitorRow);
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