/* -------------------------------------------------------------
   BLINKIT BI DASHBOARD CONTROLLER ENGINE (app.js)
   ------------------------------------------------------------- */

// Global Dashboard State
let rawGroceryData = [];
let filteredGroceryData = [];
let heartedOutlets = new Set(); // Stores favorited Outlet Identifiers

// Active Slicers State
const activeFilters = {
    searchQuery: '',
    fatContent: 'All',
    locationTier: 'All',
    outletSize: 'All',
    itemType: 'All',
    favoritesOnly: false
};

// Table Pagination State
const pagination = {
    currentPage: 1,
    pageSize: 10,
    totalPages: 1
};

// ApexCharts Instances (for clean rebuilding)
let chartSalesTimeline = null;
let chartProductPerformance = null;
let chartFatDistribution = null;
let chartOutletDimension = null;

// Initial Setup on Document Load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize date stamp
    const options = { month: 'long', year: 'numeric' };
    document.getElementById('current-date-span').innerText = new Date().toLocaleDateString('en-US', options);

    // Initialize Favorites list from localStorage
    loadFavoritesFromStorage();

    // Set up core event listeners
    setupEventListeners();

    // Load Data
    loadDashboardDataset();
});

/* -------------------------------------------------------------
   DATA LOADING & CLEANSING
   ------------------------------------------------------------- */

// Tries to fetch the local CSV file automatically, falls back to manual drop zone if CORS blocked
async function loadDashboardDataset() {
    try {
        const response = await fetch('BlinkIT Grocery Data.csv');
        if (!response.ok) {
            throw new Error('Local file fetch returned bad status');
        }
        const csvText = await response.text();
        parseCSVText(csvText);
    } catch (error) {
        console.warn('CORS or file access restriction blocked automatic loading. Displaying drag-and-drop upload screen.', error);
        showFileUploaderOverlay();
    }
}

// Shows full screen drag-and-drop box
function showFileUploaderOverlay() {
    const overlay = document.getElementById('file-uploader-overlay');
    overlay.classList.remove('hidden');

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('csv-file-input');

    // Drag and Drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            handleUploadedFile(files[0]);
        }
    });

    // File input select
    fileInput.addEventListener('change', (e) => {
        if (fileInput.files.length) {
            handleUploadedFile(fileInput.files[0]);
        }
    });
}

// Parses uploaded file text
function handleUploadedFile(file) {
    const status = document.getElementById('upload-status');
    status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Reading file...`;
    status.className = 'upload-status';

    const reader = new FileReader();
    reader.onload = function(e) {
        const csvText = e.target.result;
        try {
            parseCSVText(csvText);
            status.innerHTML = `<i class="fa-solid fa-circle-check"></i> Loaded successfully!`;
            status.className = 'upload-status success';
            setTimeout(() => {
                document.getElementById('file-uploader-overlay').classList.add('hidden');
                triggerConfettiExplosion();
            }, 1000);
        } catch (err) {
            status.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error parsing CSV structure.`;
            status.className = 'upload-status error';
        }
    };
    reader.readAsText(file);
}

// Core parsing using PapaParse
function parseCSVText(csvText) {
    Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            if (results.errors.length && results.data.length === 0) {
                throw new Error('PapaParse failed to read CSV');
            }
            cleanAndLoadDataset(results.data);
        }
    });
}

// Data standardizing and metric casting
function cleanAndLoadDataset(dataList) {
    rawGroceryData = dataList.map(row => {
        // Standardize Fat Content
        let fat = row['Item Fat Content'] ? row['Item Fat Content'].trim() : '';
        if (fat.toLowerCase() === 'low fat' || fat.toLowerCase() === 'lf') {
            fat = 'Low Fat';
        } else if (fat.toLowerCase() === 'regular' || fat.toLowerCase() === 'reg') {
            fat = 'Regular';
        } else {
            fat = 'Low Fat'; // Fallback
        }

        // Standardize Outlet Size
        let size = row['Outlet Size'] ? row['Outlet Size'].trim() : '';
        if (!size || size.toLowerCase() === 'null' || size.toLowerCase() === 'undefined') {
            size = 'Not Specified';
        }

        // Parse numerical columns safely
        const totalSales = parseFloat(row['Total Sales']) || 0;
        const rating = parseInt(row['Rating']) || 5;
        const visibility = parseFloat(row['Item Visibility']) || 0;
        const estYear = parseInt(row['Outlet Establishment Year']) || 2015;

        return {
            itemFatContent: fat,
            itemIdentifier: row['Item Identifier'] || '',
            itemType: row['Item Type'] || 'Others',
            outletEstablishmentYear: estYear,
            outletIdentifier: row['Outlet Identifier'] || 'OUT000',
            outletLocationType: row['Outlet Location Type'] || 'Tier 3',
            outletSize: size,
            outletType: row['Outlet Type'] || 'Supermarket Type1',
            itemVisibility: visibility,
            itemWeight: parseFloat(row['Item Weight']) || 0,
            totalSales: totalSales,
            rating: rating
        };
    });

    // Populate dynamic Slicer dropdown lists
    populateProductTypeSelector();

    // Trigger full calculation and chart update
    updateDashboardView();
}

// Collects unique Product Types to render filter dropdown options
function populateProductTypeSelector() {
    const productTypes = [...new Set(rawGroceryData.map(d => d.itemType))].sort();
    const dropdown = document.getElementById('filter-item-type');
    
    // Clear and add placeholder option
    dropdown.innerHTML = `<option value="All">All Product Types (${productTypes.length})</option>`;
    
    productTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        dropdown.appendChild(option);
    });
}

/* -------------------------------------------------------------
   CORE ENGINE: AGGREGATE CALCULATIONS & RE-FILTERING
   ------------------------------------------------------------- */

function updateDashboardView() {
    // Apply active filter slicers to the raw dataset
    filteredGroceryData = rawGroceryData.filter(d => {
        // 1. Text Search Box (Item Identifier or Outlet Identifier)
        if (activeFilters.searchQuery) {
            const query = activeFilters.searchQuery.toLowerCase();
            const matchesItem = d.itemIdentifier.toLowerCase().includes(query);
            const matchesOutlet = d.outletIdentifier.toLowerCase().includes(query);
            const matchesType = d.itemType.toLowerCase().includes(query);
            if (!matchesItem && !matchesOutlet && !matchesType) return false;
        }

        // 2. Fat Content Slicer
        if (activeFilters.fatContent !== 'All') {
            if (d.itemFatContent !== activeFilters.fatContent) return false;
        }

        // 3. Location Tier Slicer
        if (activeFilters.locationTier !== 'All') {
            if (d.outletLocationType !== activeFilters.locationTier) return false;
        }

        // 4. Outlet Size Slicer
        if (activeFilters.outletSize !== 'All') {
            if (d.outletSize !== activeFilters.outletSize) return false;
        }

        // 5. Product Category Slicer
        if (activeFilters.itemType !== 'All') {
            if (d.itemType !== activeFilters.itemType) return false;
        }

        // 6. Favorites-Only Filter Utility
        if (activeFilters.favoritesOnly) {
            if (!heartedOutlets.has(d.outletIdentifier)) return false;
        }

        return true;
    });

    // Recompute key performance indicators (KPIs)
    calculateKPIs();

    // Re-draw ApexCharts panels
    renderDashboardCharts();

    // Re-render Transaction Ledger Data Grid
    pagination.currentPage = 1;
    renderDetailsGrid();

    // Update Favorites counts in sidebar badge
    document.getElementById('fav-count').textContent = heartedOutlets.size;
}

// Computes standard math aggregates for high-level cards
function calculateKPIs() {
    const totalCount = filteredGroceryData.length;
    
    if (totalCount === 0) {
        document.getElementById('kpi-total-sales').innerText = '₹0.00';
        document.getElementById('kpi-avg-rating').innerText = '0.00';
        document.getElementById('kpi-total-items').innerText = '0';
        document.getElementById('kpi-avg-visibility').innerText = '0.00%';
        document.getElementById('heart-stars-rating').innerHTML = '<i class="fa-regular fa-heart"></i>';
        return;
    }

    let salesSum = 0;
    let ratingSum = 0;
    let visibilitySum = 0;

    for (let i = 0; i < totalCount; i++) {
        const item = filteredGroceryData[i];
        salesSum += item.totalSales;
        ratingSum += item.rating;
        visibilitySum += item.itemVisibility;
    }

    const avgRating = ratingSum / totalCount;
    const avgVisibility = (visibilitySum / totalCount) * 100;

    // Formatting outputs: Large numbers format (e.g. ₹1.20M or ₹356K)
    document.getElementById('kpi-total-sales').innerText = formatLargeCurrency(salesSum);
    document.getElementById('kpi-avg-rating').innerText = avgRating.toFixed(2);
    document.getElementById('kpi-total-items').innerText = totalCount.toLocaleString();
    document.getElementById('kpi-avg-visibility').innerText = avgVisibility.toFixed(2) + '%';

    // Set Customer Trust Hearts indicator rating
    renderHeartsRatingIndicator(avgRating);
}

// Renders visual heart icons based on score
function renderHeartsRatingIndicator(score) {
    const container = document.getElementById('heart-stars-rating');
    container.innerHTML = '';
    
    const fullHearts = Math.floor(score);
    const hasHalf = score % 1 >= 0.4;
    const emptyHearts = 5 - fullHearts - (hasHalf ? 1 : 0);

    for (let i = 0; i < fullHearts; i++) {
        container.innerHTML += '<i class="fa-solid fa-heart"></i>';
    }
    if (hasHalf) {
        container.innerHTML += '<i class="fa-solid fa-heart-crack"></i>';
    }
    for (let i = 0; i < emptyHearts; i++) {
        container.innerHTML += '<i class="fa-regular fa-heart"></i>';
    }
}

// Large numbers currency formatter (₹M or ₹K)
function formatLargeCurrency(num) {
    if (num >= 1000000) {
        return '₹' + (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
        return '₹' + (num / 1000).toFixed(1) + 'K';
    }
    return '₹' + num.toFixed(2);
}

/* -------------------------------------------------------------
   INTERACTIVE APEXCHARTS VISUALIZATION BUILDERS
   ------------------------------------------------------------- */

function renderDashboardCharts() {
    // 1. Chart: Sales Trend & Timelines (Annual Launch Timeline)
    renderSalesTrendTimelineChart();

    // 2. Chart: Product Performance rank
    renderProductPerformanceChart();

    // 3. Chart: Fat Content Donut
    renderFatContentDistributionChart();

    // 4. Chart: Outlet Location & Size stacked column
    renderOutletDimensionChart();
}

// Line / Area chart showing outlet launch timelines
function renderSalesTrendTimelineChart() {
    // Group and sum sales by year
    const yearSalesMap = {};
    filteredGroceryData.forEach(d => {
        yearSalesMap[d.outletEstablishmentYear] = (yearSalesMap[d.outletEstablishmentYear] || 0) + d.totalSales;
    });

    const sortedYears = Object.keys(yearSalesMap).map(Number).sort((a, b) => a - b);
    const salesValues = sortedYears.map(yr => Math.round(yearSalesMap[yr]));

    const options = {
        series: [{
            name: 'Annual Sales Revenue',
            data: salesValues
        }],
        chart: {
            type: 'area',
            height: 300,
            toolbar: { show: true },
            zoom: { enabled: true },
            animations: { enabled: true }
        },
        dataLabels: { enabled: false },
        stroke: {
            curve: 'smooth',
            width: 3,
            colors: ['#fb7185'] // Soft rose accent
        },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.45,
                opacityTo: 0.05,
                stops: [0, 95],
                colorStops: [
                    { offset: 0, color: '#fb7185', opacity: 0.45 },
                    { offset: 100, color: '#fb7185', opacity: 0.05 }
                ]
            }
        },
        xaxis: {
            categories: sortedYears,
            labels: {
                style: {
                    colors: 'var(--text-secondary)',
                    fontFamily: 'Inter, sans-serif'
                }
            }
        },
        yaxis: {
            labels: {
                style: { colors: 'var(--text-secondary)' },
                formatter: function(val) { return '₹' + val.toLocaleString(); }
            }
        },
        tooltip: {
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
            y: { formatter: (val) => '₹' + val.toLocaleString() }
        },
        grid: {
            borderColor: 'var(--border-color)',
            strokeDashArray: 4
        }
    };

    if (chartSalesTimeline) {
        chartSalesTimeline.destroy();
    }
    
    chartSalesTimeline = new ApexCharts(document.querySelector("#chart-sales-timeline"), options);
    chartSalesTimeline.render();
}

// Horizontal rank bar chart for categories
function renderProductPerformanceChart() {
    const categoryMap = {};
    filteredGroceryData.forEach(d => {
        categoryMap[d.itemType] = (categoryMap[d.itemType] || 0) + d.totalSales;
    });

    const sortedCategories = Object.keys(categoryMap)
        .map(cat => ({ name: cat, value: Math.round(categoryMap[cat]) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10); // Display top 10

    const categories = sortedCategories.map(c => c.name);
    const values = sortedCategories.map(c => c.value);

    const options = {
        series: [{
            name: 'Total Sales Revenue',
            data: values
        }],
        chart: {
            type: 'bar',
            height: 320,
            toolbar: { show: false }
        },
        plotOptions: {
            bar: {
                horizontal: true,
                barHeight: '65%',
                distributed: true,
                borderRadius: 4
            }
        },
        colors: [
            '#fb7185', '#fda4af', '#f472b6', '#c084fc', 
            '#a5b4fc', '#818cf8', '#93c5fd', '#38bdf8', 
            '#2dd4bf', '#34d399'
        ], // Elegant soft pastel palette
        dataLabels: { enabled: false },
        xaxis: {
            categories: categories,
            labels: {
                style: { colors: 'var(--text-secondary)' },
                formatter: function(val) { return '₹' + (val / 1000).toFixed(0) + 'K'; }
            }
        },
        yaxis: {
            labels: {
                style: {
                    colors: 'var(--text-secondary)',
                    fontWeight: 600
                }
            }
        },
        tooltip: {
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
            y: { formatter: (val) => '₹' + val.toLocaleString() }
        },
        grid: {
            borderColor: 'var(--border-color)',
            strokeDashArray: 4
        },
        legend: { show: false }
    };

    if (chartProductPerformance) {
        chartProductPerformance.destroy();
    }
    
    chartProductPerformance = new ApexCharts(document.querySelector("#chart-product-performance"), options);
    chartProductPerformance.render();
}

// 3D/Flat Donut Chart showing low fat vs regular splits
function renderFatContentDistributionChart() {
    const fatMap = { 'Low Fat': 0, 'Regular': 0 };
    filteredGroceryData.forEach(d => {
        if (d.itemFatContent in fatMap) {
            fatMap[d.itemFatContent] += d.totalSales;
        }
    });

    const categories = Object.keys(fatMap);
    const values = categories.map(cat => Math.round(fatMap[cat]));

    const options = {
        series: values,
        chart: {
            type: 'donut',
            height: 320
        },
        labels: categories,
        colors: ['#38bdf8', '#fb7185'], // Soft Sky Blue and Soft Pink
        stroke: { show: false },
        plotOptions: {
            pie: {
                donut: {
                    size: '72%',
                    background: 'transparent',
                    labels: {
                        show: true,
                        name: {
                            show: true,
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--text-secondary)'
                        },
                        value: {
                            show: true,
                            fontSize: '22px',
                            fontWeight: 800,
                            color: 'var(--text-primary)',
                            formatter: function(val) { return '₹' + parseInt(val).toLocaleString(); }
                        },
                        total: {
                            show: true,
                            label: 'Total Active',
                            color: 'var(--text-muted)',
                            formatter: function(w) {
                                const sum = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                return '₹' + sum.toLocaleString();
                            }
                        }
                    }
                }
            }
        },
        legend: {
            position: 'bottom',
            fontSize: '12px',
            fontFamily: 'Inter, sans-serif',
            labels: { colors: 'var(--text-primary)' },
            markers: { radius: 6 }
        },
        tooltip: {
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
            y: { formatter: (val) => '₹' + val.toLocaleString() }
        }
    };

    if (chartFatDistribution) {
        chartFatDistribution.destroy();
    }
    
    chartFatDistribution = new ApexCharts(document.querySelector("#chart-fat-distribution"), options);
    chartFatDistribution.render();
}

// Stacked Column chart: Location Tier and Store Size comparison
function renderOutletDimensionChart() {
    // Nested aggregation
    const sizeKeys = ['Small', 'Medium', 'High', 'Not Specified'];
    const locationTiers = ['Tier 1', 'Tier 2', 'Tier 3'];
    
    // Structure map: { 'Tier 1': { 'Small': 0, 'Medium': 0 ... } }
    const matrix = {};
    locationTiers.forEach(t => {
        matrix[t] = {};
        sizeKeys.forEach(s => { matrix[t][s] = 0; });
    });

    filteredGroceryData.forEach(d => {
        if (d.outletLocationType in matrix && d.outletSize in matrix[d.outletLocationType]) {
            matrix[d.outletLocationType][d.outletSize] += d.totalSales;
        }
    });

    // Format series for ApexCharts
    const series = sizeKeys.map(size => {
        return {
            name: size === 'Not Specified' ? 'Unspecified' : size + ' Size',
            data: locationTiers.map(tier => Math.round(matrix[tier][size]))
        };
    });

    const options = {
        series: series,
        chart: {
            type: 'bar',
            height: 320,
            stacked: true,
            toolbar: { show: false }
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '45%',
                borderRadius: 6
            }
        },
        xaxis: {
            categories: locationTiers,
            labels: {
                style: {
                    colors: 'var(--text-secondary)',
                    fontWeight: 600
                }
            }
        },
        yaxis: {
            labels: {
                style: { colors: 'var(--text-secondary)' },
                formatter: function(val) { return '₹' + (val / 1000).toFixed(0) + 'K'; }
            }
        },
        colors: ['#34d399', '#818cf8', '#fbbf24', '#94a3b8'], // Soft Mint, Soft Indigo, Soft Amber, Slate Gray
        stroke: {
            width: 1,
            colors: ['rgba(255,255,255,0.05)']
        },
        tooltip: {
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
            y: { formatter: (val) => '₹' + val.toLocaleString() }
        },
        legend: {
            position: 'top',
            fontSize: '12px',
            labels: { colors: 'var(--text-primary)' }
        },
        grid: {
            borderColor: 'var(--border-color)',
            strokeDashArray: 4
        }
    };

    if (chartOutletDimension) {
        chartOutletDimension.destroy();
    }
    
    chartOutletDimension = new ApexCharts(document.querySelector("#chart-outlet-dimension"), options);
    chartOutletDimension.render();
}

/* -------------------------------------------------------------
   DATA DATA-GRID & LEDGER TABLE RENDERING
   ------------------------------------------------------------- */

function renderDetailsGrid() {
    const tbody = document.getElementById('transaction-table-body');
    const startIdxSpan = document.getElementById('page-start-idx');
    const endIdxSpan = document.getElementById('page-end-idx');
    const totalCountSpan = document.getElementById('page-total-count');
    const tableRowCountSpan = document.getElementById('table-row-count');

    const totalRecords = filteredGroceryData.length;
    tableRowCountSpan.innerText = totalRecords.toLocaleString();
    totalCountSpan.innerText = totalRecords.toLocaleString();

    if (totalRecords === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 40px;"><i class="fa-solid fa-face-frown" style="font-size: 24px; color: var(--accent-pink); margin-bottom: 8px; display:block;"></i> No grocery items match your slicers!</td></tr>`;
        startIdxSpan.innerText = '0';
        endIdxSpan.innerText = '0';
        updatePaginationControls(0);
        return;
    }

    // Determine slice range
    pagination.totalPages = Math.ceil(totalRecords / pagination.pageSize);
    if (pagination.currentPage > pagination.totalPages) {
        pagination.currentPage = pagination.totalPages;
    }

    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;
    const endIdx = Math.min(startIdx + pagination.pageSize, totalRecords);

    startIdxSpan.innerText = (startIdx + 1).toLocaleString();
    endIdxSpan.innerText = endIdx.toLocaleString();

    const activeRows = filteredGroceryData.slice(startIdx, endIdx);

    tbody.innerHTML = '';
    activeRows.forEach(row => {
        const tr = document.createElement('tr');
        
        // Check if outlet is in favorited hearted list
        const isHearted = heartedOutlets.has(row.outletIdentifier);
        const heartClass = isHearted ? 'fa-solid fa-heart hearted' : 'fa-regular fa-heart';
        const favTitle = isHearted ? 'Remove outlet from Favorites' : 'Add outlet to Favorites';

        tr.innerHTML = `
            <td><strong>${escapeHtml(row.itemIdentifier)}</strong></td>
            <td>${escapeHtml(row.itemType)}</td>
            <td><span class="badge ${row.itemFatContent === 'Low Fat' ? 'bg-blue' : 'bg-orange'}">${escapeHtml(row.itemFatContent)}</span></td>
            <td><span class="badge bg-purple">${escapeHtml(row.outletIdentifier)}</span></td>
            <td>${escapeHtml(row.outletSize)}</td>
            <td>${escapeHtml(row.outletLocationType)}</td>
            <td>
                <span class="text-pink">
                    ${'★'.repeat(row.rating)}${'☆'.repeat(5 - row.rating)}
                </span>
            </td>
            <td class="text-right"><strong>₹${row.totalSales.toFixed(2)}</strong></td>
            <td class="text-center" id="td-fav-row-exclude">
                <button class="btn-row-heart" data-store="${escapeHtml(row.outletIdentifier)}" title="${favTitle}">
                    <i class="${heartClass}"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    // Connect row clicks
    const heartButtons = tbody.querySelectorAll('.btn-row-heart');
    heartButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const storeId = btn.getAttribute('data-store');
            toggleOutletHeartState(storeId, btn);
        });
    });

    updatePaginationControls(totalRecords);
}

// Heart / Favorite outlet state toggle
function toggleOutletHeartState(storeId, buttonElement) {
    const icon = buttonElement.querySelector('i');
    
    if (heartedOutlets.has(storeId)) {
        heartedOutlets.delete(storeId);
        icon.className = 'fa-regular fa-heart';
        buttonElement.classList.remove('hearted');
        buttonElement.title = 'Add outlet to Favorites';
    } else {
        heartedOutlets.add(storeId);
        icon.className = 'fa-solid fa-heart hearted';
        buttonElement.classList.add('hearted');
        buttonElement.title = 'Remove outlet from Favorites';

        // DELIGHTFUL USER INTERACTION: Sparkly confetti explosion!
        triggerConfettiExplosion();
    }

    // Persist Choice
    saveFavoritesToStorage();

    // Update global badge
    document.getElementById('fav-count').textContent = heartedOutlets.size;

    // Refresh if favoritesOnly toggle is currently active
    if (activeFilters.favoritesOnly) {
        updateDashboardView();
    }
}

// Canvas confetti blast helper
function triggerConfettiExplosion() {
    if (window.confetti) {
        window.confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#f43f5e', '#ec4899', '#a855f7', '#6366f1']
        });
    }
}

// Sort index numbers & layout page counts
function updatePaginationControls(totalRecords) {
    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');
    const pageNumContainer = document.getElementById('page-numbers');

    prevBtn.disabled = pagination.currentPage <= 1;
    nextBtn.disabled = pagination.currentPage >= pagination.totalPages || pagination.totalPages === 0;

    pageNumContainer.innerHTML = '';
    
    // Standard BI pagination boundary logic (max 5 buttons visible)
    const maxVisible = 5;
    let startPage = Math.max(1, pagination.currentPage - 2);
    let endPage = Math.min(pagination.totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `page-number ${i === pagination.currentPage ? 'active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => {
            pagination.currentPage = i;
            renderDetailsGrid();
        });
        pageNumContainer.appendChild(btn);
    }
}

/* -------------------------------------------------------------
   EXPORTS & DOWNLOAD CONTROLLERS
   ------------------------------------------------------------- */

// Export active filtered rows to a clean physical CSV download
function triggerFilteredCSVDownload() {
    if (filteredGroceryData.length === 0) {
        alert('There is no active filtered dataset to download!');
        return;
    }

    const headers = [
        'Item Identifier', 'Item Type', 'Item Fat Content', 'Item Visibility', 'Item Weight',
        'Outlet Identifier', 'Outlet Size', 'Outlet Location Type', 'Outlet Type', 
        'Outlet Establishment Year', 'Total Sales', 'Rating'
    ];

    // Build CSV Row array
    const csvRows = [headers.join(',')];

    filteredGroceryData.forEach(d => {
        const row = [
            `"${d.itemIdentifier}"`,
            `"${d.itemType}"`,
            `"${d.itemFatContent}"`,
            d.itemVisibility,
            d.itemWeight,
            `"${d.outletIdentifier}"`,
            `"${d.outletSize}"`,
            `"${d.outletLocationType}"`,
            `"${d.outletType}"`,
            d.outletEstablishmentYear,
            d.totalSales,
            d.rating
        ];
        csvRows.push(row.join(','));
    });

    const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(csvBlob);
    
    const downloadLink = document.createElement('a');
    downloadLink.setAttribute('href', url);
    downloadLink.setAttribute('download', `blinkit_filtered_grocery_data_${getTimestampString()}.csv`);
    downloadLink.style.visibility = 'hidden';
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    triggerConfettiExplosion();
}

// Captures vector PDF of the dashboard view using html2pdf
function triggerDashboardPDFDownload() {
    const dashboardRoot = document.getElementById('dashboard-print-root');
    
    // Add print processing state styles
    document.body.classList.add('is-printing');
    
    const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `BlinkIT_Executive_Report_${getTimestampString()}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, 
            useCORS: true,
            backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#090d16' : '#f1f5f9'
        },
        jsPDF:        { unit: 'mm', format: 'a3', orientation: 'portrait' }
    };

    // Build pdf using html2pdf library loaded in browser CDN
    html2pdf().set(opt).from(dashboardRoot).save().then(() => {
        document.body.classList.remove('is-printing');
        triggerConfettiExplosion();
    });
}

/* -------------------------------------------------------------
   LOCALSTORAGE & EVENT BINDINGS UTILS
   ------------------------------------------------------------- */

function saveFavoritesToStorage() {
    localStorage.setItem('blinkit_favorites', JSON.stringify([...heartedOutlets]));
}

function loadFavoritesFromStorage() {
    try {
        const stored = localStorage.getItem('blinkit_favorites');
        if (stored) {
            heartedOutlets = new Set(JSON.parse(stored));
        }
    } catch (e) {
        console.error('Failed to parse favorites from local storage', e);
    }
}

// Binds actions to UI components
function setupEventListeners() {
    // 1. Text Search Input with basic debounce keyup handler
    let searchTimeout;
    document.getElementById('filter-search').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            activeFilters.searchQuery = e.target.value;
            updateDashboardView();
        }, 300);
    });

    // 2. Data ledger specific search box
    document.getElementById('table-search-input').addEventListener('input', (e) => {
        activeFilters.searchQuery = e.target.value;
        // Sync with primary input
        document.getElementById('filter-search').value = e.target.value;
        updateDashboardView();
    });

    // 3. Pill Groups selectors (Fat Content, Location Tier, Outlet Size)
    setupPillGroupSelector('filter-fat', 'fatContent');
    setupPillGroupSelector('filter-location', 'locationTier');
    setupPillGroupSelector('filter-size', 'outletSize');

    // 4. Category Dropdown
    document.getElementById('filter-item-type').addEventListener('change', (e) => {
        activeFilters.itemType = e.target.value;
        updateDashboardView();
    });

    // 5. Global Reset All Filters
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
        // Reset state values
        activeFilters.searchQuery = '';
        activeFilters.fatContent = 'All';
        activeFilters.locationTier = 'All';
        activeFilters.outletSize = 'All';
        activeFilters.itemType = 'All';
        activeFilters.favoritesOnly = false;

        // Reset controls display
        document.getElementById('filter-search').value = '';
        document.getElementById('table-search-input').value = '';
        document.getElementById('filter-item-type').value = 'All';
        
        // Reset active pill classes
        resetPillGroupUI('filter-fat');
        resetPillGroupUI('filter-location');
        resetPillGroupUI('filter-size');

        // Reset Hearts Mode toggle button style
        const btnToggle = document.getElementById('btn-toggle-favorites-only');
        btnToggle.classList.remove('btn-primary');
        btnToggle.classList.add('btn-heart-accent');
        btnToggle.innerHTML = `<i class="fa-solid fa-heart"></i> Show Hearted Only`;

        updateDashboardView();
        triggerConfettiExplosion();
    });

    // 6. Favorites-Only Toggle
    document.getElementById('btn-toggle-favorites-only').addEventListener('click', function() {
        activeFilters.favoritesOnly = !activeFilters.favoritesOnly;
        
        if (activeFilters.favoritesOnly) {
            this.classList.remove('btn-heart-accent');
            this.classList.add('btn-primary');
            this.innerHTML = `<i class="fa-solid fa-heart"></i> Showing Hearted`;
            triggerConfettiExplosion();
        } else {
            this.classList.remove('btn-primary');
            this.classList.add('btn-heart-accent');
            this.innerHTML = `<i class="fa-solid fa-heart"></i> Show Hearted Only`;
        }
        updateDashboardView();
    });

    // 7. Ledger table page sizes
    document.getElementById('table-page-size').addEventListener('change', (e) => {
        pagination.pageSize = parseInt(e.target.value) || 10;
        pagination.currentPage = 1;
        renderDetailsGrid();
    });

    // 8. Pagination buttons prev/next
    document.getElementById('btn-page-prev').addEventListener('click', () => {
        if (pagination.currentPage > 1) {
            pagination.currentPage--;
            renderDetailsGrid();
        }
    });

    document.getElementById('btn-page-next').addEventListener('click', () => {
        if (pagination.currentPage < pagination.totalPages) {
            pagination.currentPage++;
            renderDetailsGrid();
        }
    });

    // 9. Downloads buttons triggers
    document.getElementById('btn-download-csv').addEventListener('click', triggerFilteredCSVDownload);
    document.getElementById('btn-download-pdf').addEventListener('click', triggerDashboardPDFDownload);

    // 10. Theme Mode Toggle Switcher
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        
        // Dynamic re-render charts to adapt colors, backgrounds, and themes
        renderDashboardCharts();
    });

    // 11. Joy heart box click decoration
    document.getElementById('heart-pulse-box').addEventListener('click', () => {
        triggerConfettiExplosion();
    });
}

// Binds click updates to selectors pill categories
function setupPillGroupSelector(containerId, stateProperty) {
    const container = document.getElementById(containerId);
    container.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;

        // Toggle selected styling
        container.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        // Set value
        activeFilters[stateProperty] = pill.getAttribute('data-value');
        updateDashboardView();
    });
}

// Resets pill sets to "All" active
function resetPillGroupUI(containerId) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('.pill').forEach(p => {
        if (p.getAttribute('data-value') === 'All') {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });
}

// Helpers
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

function getTimestampString() {
    const now = new Date();
    return now.getFullYear() + '' +
           String(now.getMonth() + 1).padStart(2, '0') + '' +
           String(now.getDate()).padStart(2, '0') + '_' +
           String(now.getHours()).padStart(2, '0') +
           String(now.getMinutes()).padStart(2, '0');
}
