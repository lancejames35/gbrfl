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
  const itemsPerPage = 500; // Plenty of room for multi-season history
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

    // Set transaction ID for reference (updated from request_id to transaction_id)
    mainRow.setAttribute('data-transaction-id', transaction.transaction_id);

    // Set team and owner name
    transactionRow.querySelector('.owner-name').innerHTML = `
      <strong>${transaction.team_name}</strong><br>
      <small class="text-muted">${transaction.first_name} ${transaction.last_name}</small>
    `;

    // Set transaction type based on transaction_type
    const typeEl = transactionRow.querySelector('.transaction-type');
    if (transaction.transaction_type === 'Waiver') {
      if (transaction.attempted_players) {
        typeEl.textContent = `Waiver REJECTED`;
        typeEl.className = 'transaction-type badge bg-danger';
      } else {
        typeEl.textContent = `Waiver Wire (${transaction.waiver_round} Round)`;
        typeEl.className = 'transaction-type badge bg-primary';
      }
    } else if (transaction.transaction_type === 'Trade') {
      typeEl.textContent = 'Trade';
      typeEl.className = 'transaction-type badge bg-success';
    } else {
      typeEl.textContent = transaction.transaction_type;
      typeEl.className = 'transaction-type badge bg-secondary';
    }

    // Set acquired items
    const acquiredEl = transactionRow.querySelector('.acquired');
    if (transaction.transaction_type === 'Waiver') {
      // Check if this is a rejected waiver attempt
      if (transaction.attempted_players) {
        acquiredEl.innerHTML = `<span class="text-muted">REJECTED: ${transaction.attempted_players}</span>`;
      } else if (transaction.pickup_name) {
        // For successful waivers, use individual pickup fields for compatibility
        acquiredEl.textContent = `${transaction.pickup_name} (${transaction.pickup_position})`;
      } else {
        // For new unified system, use acquired_players
        acquiredEl.textContent = transaction.acquired_players || '--';
      }
    } else {
      // For trades and other types, use the full acquired_players string
      acquiredEl.textContent = transaction.acquired_players || '--';
    }

    // Set lost/dropped items
    const lostEl = transactionRow.querySelector('.lost');
    if (transaction.transaction_type === 'Waiver') {
      // Check if this is a rejected waiver attempt
      if (transaction.attempted_players) {
        lostEl.innerHTML = `<span class="text-muted">--</span>`;
      } else if (transaction.drop_name) {
        // For successful waivers, use individual drop fields for compatibility
        lostEl.textContent = `${transaction.drop_name} (${transaction.drop_position})`;
      } else {
        // For new unified system, use lost_players
        lostEl.textContent = transaction.lost_players || '--';
      }
    } else {
      // For trades and other types, use the full lost_players string
      lostEl.textContent = transaction.lost_players || '--';
    }

    // Handle competitors (only for waiver transactions)
    const expandBtn = transactionRow.querySelector('.expand-btn');
    const competitorsSection = transactionRow.querySelector('.competitors-section');

    console.log(`Transaction ${transaction.transaction_id} (${transaction.transaction_type}) has ${transaction.competitors ? transaction.competitors.length : 0} competitors`);

    if (transaction.transaction_type === 'Waiver' && transaction.competitors && transaction.competitors.length > 0) {
      console.log(`Showing expand button for waiver transaction ${transaction.transaction_id}`);
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
      console.log(`No competitors for transaction ${transaction.transaction_id} (type: ${transaction.transaction_type})`);
    }

    // Append to container
    transactionsContainer.appendChild(transactionRow);
  }

  /**
   * Converts a number to ordinal format (1st, 2nd, 3rd, etc.)
   * @param {number} num - The number to convert
   * @returns {string} - The ordinal representation
   */
  function toOrdinal(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) {
      return num + "st";
    }
    if (j === 2 && k !== 12) {
      return num + "nd";
    }
    if (j === 3 && k !== 13) {
      return num + "rd";
    }
    return num + "th";
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

    // Check if competitor tried in a different round
    const winnerRound = winningTransaction.waiver_round || '1st';
    const competitorRound = competitor.waiver_round || '1st';
    const differentRound = winnerRound !== competitorRound;

    let story = '';

    if (differentRound) {
      // Competitor tried in a different round
      story = `Tried in <span class="badge bg-info">${competitorRound} round</span>, position ${toOrdinal(loserPosition)} - Lost to ${winningTransaction.team_name} who claimed in ${winnerRound} round`;
    } else if (winnerPosition < loserPosition) {
      // Winner had higher priority (lower number)
      if (positionDiff === 1) {
        story = `Lost by <span class="text-danger">1 waiver position</span> to ${winningTransaction.team_name} (${toOrdinal(winnerPosition)} vs ${toOrdinal(loserPosition)})`;
      } else if (positionDiff <= 3) {
        story = `Lost by <span class="text-warning">${positionDiff} waiver positions</span> to ${winningTransaction.team_name} (${toOrdinal(winnerPosition)} vs ${toOrdinal(loserPosition)})`;
      } else {
        story = `Lost by <span class="text-danger">${positionDiff} waiver positions</span> to ${winningTransaction.team_name} (${toOrdinal(winnerPosition)} vs ${toOrdinal(loserPosition)})`;
      }
    } else {
      // This happens when team had higher priority but already used their pick this round
      story = `Had higher priority but already used their pick this round. Lost to ${winningTransaction.team_name} (${toOrdinal(winnerPosition)} vs ${toOrdinal(loserPosition)})`;
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