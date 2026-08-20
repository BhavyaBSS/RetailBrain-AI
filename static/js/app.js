/**
 * RetailBrain AI — Central Inventory Command Tower SPA
 * Handles interactive tabs, ApexCharts rendering, dynamic scenario simulations,
 * ERP purchase order dispatching, stock transfer routing, and tail log streaming.
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // Global State
    const state = {
        activeTab: 'overview',
        summaryData: null,
        recsData: [],
        transfersData: [],
        storesData: [],
        productsData: [],
        liveInventory: [],
        liveInventorySearch: [],
        transfersSearch: [],
        charts: {},
        isPipelineRunning: false
    };

    // Initialize Lucide Icons
    if (window.lucide) {
        lucide.createIcons();
    }

    // Initialize Navigation & Event Listeners
    initNavigation();
    initMobileSidebar();
    initSimulators();
    initActionButtons();
    
    // Initial Data Fetch
    fetchAllData();

    // Set up status poll interval (every 4 seconds)
    setInterval(checkPipelineStatus, 4000);

    // Keeps operational KPIs in sync when another user dispatches a transfer.
    setInterval(() => {
        if (!document.hidden) refreshLiveOperations();
    }, 10000);


    /* ==========================================================================
       NAVIGATION & TAB SWITCHING
       ========================================================================== */
    function initNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tabTarget = item.getAttribute('data-tab');
                switchTab(tabTarget);
                closeMobileSidebar();
            });
        });

        // Quick triggers inside overview tab
        document.querySelectorAll('.nav-trigger').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-tab-target');
                switchTab(target);
                closeMobileSidebar();
            });
        });
    }

    /* ==========================================================================
       MOBILE SIDEBAR (hamburger drawer for phones & tablets)
       ========================================================================== */
    function initMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const openBtn = document.getElementById('hamburger-btn');
        const closeBtn = document.getElementById('sidebar-close-btn');

        if (!sidebar || !overlay || !openBtn) return;

        openBtn.addEventListener('click', () => {
            sidebar.classList.add('is-open');
            overlay.classList.add('is-open');
            openBtn.setAttribute('aria-expanded', 'true');
        });

        if (closeBtn) closeBtn.addEventListener('click', closeMobileSidebar);
        overlay.addEventListener('click', closeMobileSidebar);

        // Close the drawer automatically if the viewport is resized back up to desktop width
        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) closeMobileSidebar();
        });
    }

    function closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const openBtn = document.getElementById('hamburger-btn');
        if (sidebar) sidebar.classList.remove('is-open');
        if (overlay) overlay.classList.remove('is-open');
        if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    }

    function switchTab(tabId) {
        state.activeTab = tabId;
        
        // Update Sidebar Nav UI
        document.querySelectorAll('.nav-item').forEach(item => {
            if (item.getAttribute('data-tab') === tabId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Update Tab Panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            if (pane.id === `tab-${tabId}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        // Dynamic Page Title
        const titleMap = {
            'overview': 'Executive Summary & Operational Control',
            'recommendations': 'AI Profit-Ranked Procurement Recommendations',
            'inventory': 'Live Dark Store Stock Telemetry & Inter-Store Stock Balancing',
            'simulation': 'What-If Scenario Simulation Studio',
            'suppliers': 'Multi-Criteria Supplier Matrix & Quality-Price Optimizer',
            'forecasts': '14-Day Recursive Demand Forecast Analytics',
            'history': 'Transit & PO Action History',
            'console': 'Live LightGBM Pipeline Execution Stream'
        };
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = titleMap[tabId] || 'Command Tower';

        // Refresh tab specific rendering if needed
        if (tabId === 'suppliers') {
            fetchSupplierCompare();
        } else if (tabId === 'inventory') {
            renderInventoryTable(state.liveInventory);
            renderTransfersTable(state.transfersData);
            refreshLiveOperations();
        } else if (tabId === 'forecasts') {
            loadForecastChartData();
        } else if (tabId === 'console') {
            fetchPipelineLogs();
        } else if (tabId === 'history') {
            fetchDispatchHistory();
        }
    }


    /* ==========================================================================
       API DATA FETCHING
       ========================================================================== */
    async function fetchAllData() {
        try {
            await Promise.all([
                fetchSummary(),
                fetchRecommendations(),
                fetchTransfers(),
                fetchStores(),
                fetchProducts(),
                fetchLiveInventory(),
                fetchSupplierCompare()
            ]);
            
            renderOverviewCharts();
            populateDropdownFilters();
            initSupplierSliders();
            initDataIngestionModal();
        } catch (err) {
            console.error('Error fetching initial dataset:', err);
        }
    }

    async function refreshLiveOperations() {
        const requests = [fetchSummary(), fetchTransfers()];
        if (state.activeTab === 'inventory') {
            requests.push(fetchLiveInventory(), fetchStores());
        }
        await Promise.all(requests);
    }

    async function fetchSummary() {
        try {
            const res = await fetch('/api/summary');
            if (res.ok) {
                state.summaryData = await res.json();
                updateKPIs(state.summaryData);
            }
        } catch (e) {
            console.error('Summary fetch error:', e);
        }
    }

    async function fetchRecommendations() {
        try {
            const res = await fetch('/api/recommendations');
            if (res.ok) {
                state.recsData = await res.json();
                renderRecommendationsTable(state.recsData);
            }
        } catch (e) {
            console.error('Recommendations fetch error:', e);
        }
    }

    async function fetchTransfers() {
        try {
            const res = await fetch('/api/transfers');
            if (res.ok) {
                state.transfersData = await res.json();
                state.transfersSearch = state.transfersData.map(transfer => ({
                    ...transfer,
                    searchText: [transfer.Product_ID, transfer.From_Store, transfer.To_Store, transfer.City]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase()
                }));
                if (state.activeTab === 'inventory') renderTransfersTable(state.transfersData);
            }
        } catch (e) {
            console.error('Transfers fetch error:', e);
        }
    }

    async function fetchStores() {
        try {
            const res = await fetch('/api/stores');
            if (res.ok) {
                state.storesData = await res.json();
            }
        } catch (e) {
            console.error('Stores fetch error:', e);
        }
    }

    async function fetchProducts() {
        try {
            const res = await fetch('/api/products');
            if (res.ok) {
                state.productsData = await res.json();
            }
        } catch (e) {
            console.error('Products fetch error:', e);
        }
    }

    async function fetchLiveInventory() {
        try {
            const res = await fetch('/api/inventory/live');
            if (res.ok) {
                state.liveInventory = await res.json();
                state.liveInventorySearch = state.liveInventory.map(item => ({
                    ...item,
                    searchText: [item.Product_Name, item.Product_ID, item.Store_Name, item.Store_ID, item.City]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase()
                }));
                if (state.activeTab === 'inventory') renderInventoryTable(state.liveInventory);
            }
        } catch (e) {
            console.error('Live inventory fetch error:', e);
        }
    }

    /* ==========================================================================
       KPIS & OVERVIEW DASHBOARD
       ========================================================================== */
    function updateKPIs(summary) {
        if (!summary) return;
        
        const kpiProfit = document.getElementById('kpi-profit');
        const kpiAccuracy = document.getElementById('kpi-accuracy');
        const kpiWapeDetail = document.getElementById('kpi-wape-detail');
        const kpiReorders = document.getElementById('kpi-reorders');
        const kpiTransfers = document.getElementById('kpi-transfers');
        const alertTextEl = document.getElementById('stock-alert-text');

        if (kpiProfit) {
            const val = summary.total_expected_profit_uplift_next_horizon || 2564166;
            kpiProfit.textContent = `₹${(val / 100000).toFixed(2)} Lakhs`;
        }
        if (kpiAccuracy) {
            const wape = summary.forecast_model_wape_overall || 0.09857;
            const acc = ((1 - wape) * 100).toFixed(2);
            kpiAccuracy.textContent = `${acc}%`;
            if (kpiWapeDetail) {
                kpiWapeDetail.textContent = `WAPE: ${(wape * 100).toFixed(2)}% (MAE: 1.05 units)`;
            }
        }
        const reordersCount = summary.combos_needing_reorder ?? 1394;
        const transfersCount = summary.stock_transfer_recommendations ?? 303;
        
        if (kpiReorders) kpiReorders.textContent = reordersCount.toLocaleString();
        if (kpiTransfers) kpiTransfers.textContent = transfersCount.toLocaleString();

        if (alertTextEl) {
            alertTextEl.innerHTML = `⚠️ <strong>${reordersCount} Store &times; Product series</strong> are currently at or below their calculated Reorder Point (ROP). <strong>${transfersCount} inter-store stock transfers</strong> are ready for truck dispatch to satisfy shortages before buying new vendor stock.`;
        }
    }

    function renderOverviewCharts() {
        if (typeof ApexCharts === 'undefined') return;

        // Chart 1: WAPE Performance
        const wapeOptions = {
            chart: { type: 'bar', height: 260, toolbar: { show: false }, background: 'transparent' },
            theme: { mode: 'dark' },
            colors: ['#00f2fe', '#10b981', '#f59e0b'],
            series: [{
                name: 'Forecast Error (WAPE %)',
                data: [9.86, 9.76, 11.35]
            }],
            plotOptions: { bar: { borderRadius: 6, distributed: true, columnWidth: '50%' } },
            dataLabels: { enabled: true, formatter: (val) => `${val}%` },
            xaxis: { categories: ['Overall Model', 'Normal Days', 'Festival Surge Days'] },
            yaxis: { title: { text: 'WAPE %' }, max: 20 },
            grid: { borderColor: 'rgba(255, 255, 255, 0.05)' }
        };

        if (state.charts.wape) state.charts.wape.destroy();
        const wapeEl = document.getElementById('chart-wape-breakdown');
        if (wapeEl) {
            state.charts.wape = new ApexCharts(wapeEl, wapeOptions);
            state.charts.wape.render();
        }

        // Chart 2: Category Profit Breakdown
        const categoryProfitMap = {};
        state.recsData.forEach(item => {
            const cat = item.Category || 'Other';
            categoryProfitMap[cat] = (categoryProfitMap[cat] || 0) + (item.expected_profit || 0);
        });

        const sortedCats = Object.entries(categoryProfitMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const catLabels = sortedCats.map(c => c[0]);
        const catValues = sortedCats.map(c => Math.round(c[1]));

        const donutOptions = {
            chart: { type: 'donut', height: 260, background: 'transparent' },
            theme: { mode: 'dark' },
            series: catValues.length ? catValues : [962464, 542000, 320000, 280000, 190000],
            labels: catLabels.length ? catLabels : ['Festive Specials', 'Tea & Coffee', 'Dry Fruits', 'Dairy & Eggs', 'Snacks'],
            colors: ['#00f2fe', '#10b981', '#a855f7', '#f59e0b', '#ec4899'],
            legend: { position: 'bottom', fontSize: '11px' },
            stroke: { width: 0 }
        };

        if (state.charts.category) state.charts.category.destroy();
        const catEl = document.getElementById('chart-category-profit');
        if (catEl) {
            state.charts.category = new ApexCharts(catEl, donutOptions);
            state.charts.category.render();
        }
    }


    /* ==========================================================================
       TABLES RENDERING
       ========================================================================== */
    function renderRecommendationsTable(data) {
        const tbody = document.querySelector('#table-recommendations tbody');
        if (!tbody) return;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No matching PO recommendations found.</td></tr>';
            return;
        }

        const rowsHtml = data.slice(0, 50).map(row => `
            <tr>
                <td><strong>${row.Store_ID}</strong></td>
                <td>${row.Product_Name} <br><small class="text-muted">${row.Product_ID}</small></td>
                <td><span class="badge badge-accent">${row.Category}</span></td>
                <td><strong>${row.recommended_order_qty}</strong> units</td>
                <td><span class="text-emerald">${row.Best_Supplier_Name}</span></td>
                <td>₹${row.Best_Supplier_Price}</td>
                <td>₹${row.Selling_Price}</td>
                <td><strong style="color:#10b981;">₹${Number(row.expected_profit).toLocaleString()}</strong></td>
                <td>
                    <button class="btn-action-sm btn-approve-po" 
                        data-store="${row.Store_ID}" 
                        data-product="${row.Product_ID}" 
                        data-supplier="${row.Best_Supplier_Name}" 
                        data-qty="${row.recommended_order_qty}" 
                        data-cost="${row.procurement_cost}">
                        Dispatch #1 Seller PO
                    </button>
                </td>
                <td>
                    <button class="btn-action-sm btn-compare-sellers" 
                        style="background: rgba(0, 242, 254, 0.12); color: #00f2fe; border: 1px solid #00f2fe;"
                        data-store="${row.Store_ID}" 
                        data-product="${row.Product_ID}" 
                        data-productname="${row.Product_Name}" 
                        data-qty="${row.recommended_order_qty}">
                        ⚖️ Compare All 3 Sellers
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.innerHTML = rowsHtml;
        bindPOButtons();
        bindCompareSellersButtons();
    }

    function bindCompareSellersButtons() {
        document.querySelectorAll('.btn-compare-sellers').forEach(btn => {
            btn.addEventListener('click', () => {
                const product_id = btn.getAttribute('data-product');
                const product_name = btn.getAttribute('data-productname');
                const store_id = btn.getAttribute('data-store');
                const order_qty = parseInt(btn.getAttribute('data-qty')) || 100;

                openSupplierCompareModal(product_id, product_name, store_id, order_qty);
            });
        });
    }

    function openSupplierCompareModal(product_id, product_name, store_id, order_qty) {
        const modal = document.getElementById('modal-supplier-compare');
        const title = document.getElementById('modal-product-title');
        const subtitle = document.getElementById('modal-product-subtitle');
        const tbody = document.getElementById('tbody-modal-suppliers');

        if (!modal || !tbody) return;

        if (title) title.textContent = `Seller Comparison — ${product_name} (${product_id})`;
        if (subtitle) subtitle.textContent = `Store Location: ${store_id} | Recommended Qty: ${order_qty} units`;

        const itemSuppliers = (state.supplierCompareData || []).filter(s => s.Product_ID === product_id);
        itemSuppliers.sort((a, b) => (a.rank_in_product || 99) - (b.rank_in_product || 99));

        if (!itemSuppliers.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No supplier offers found for this SKU.</td></tr>';
        } else {
            const rowsHtml = itemSuppliers.map((sup, idx) => {
                const isWinner = idx === 0 || sup.rank_in_product === 1;
                const rankBadge = isWinner ? 
                    '<span class="badge badge-success"><i data-lucide="crown"></i> #1 Optimal Choice</span>' : 
                    `<span class="badge" style="background:rgba(255,255,255,0.08); color:var(--text-secondary);">Rank #${sup.rank_in_product || (idx+1)}</span>`;

                const sellingPrice = sup.Selling_Price || (sup.Supplier_Price * 1.35);
                const unitProfit = sellingPrice - sup.Supplier_Price;
                const marginPct = ((unitProfit / sellingPrice) * 100).toFixed(1);
                const totalProfit = Math.round(unitProfit * order_qty);

                return `
                    <tr style="${isWinner ? 'background: rgba(16, 185, 129, 0.08); border-left: 3px solid #10b981;' : ''}">
                        <td><strong>${sup.Supplier_Name}</strong> <br><small class="text-muted">${sup.Supplier_ID}</small></td>
                        <td><strong style="color: var(--color-cyan);">₹${sup.Supplier_Price}</strong> / unit</td>
                        <td>₹${sellingPrice} / unit</td>
                        <td><span class="text-emerald">+${marginPct}% Margin</span> <br><small class="text-muted">(Total Est. Profit: ₹${totalProfit.toLocaleString()})</small></td>
                        <td><strong style="color: ${sup.Lead_Time <= 2 ? '#10b981' : '#f59e0b'};">${sup.Lead_Time} Day${sup.Lead_Time > 1 ? 's' : ''} ${sup.Lead_Time <= 1 ? '(Express)' : ''}</strong></td>
                        <td><strong style="color: #fde047;">⭐ ${sup.Supplier_Rating} / 5.0</strong></td>
                        <td>${rankBadge}</td>
                        <td>
                            <button class="btn-action-sm ${isWinner ? 'btn-approve-po' : 'btn-outline'} btn-modal-order-supplier"
                                data-supplier="${sup.Supplier_Name}"
                                data-store="${store_id}"
                                data-product="${product_id}"
                                data-qty="${order_qty}"
                                data-price="${sup.Supplier_Price}">
                                ${isWinner ? '✓ Order #1 Optimal Seller' : 'Select This Seller'}
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
            tbody.innerHTML = rowsHtml;
        }

        modal.style.display = 'flex';
        if (window.lucide) lucide.createIcons();

        // Bind modal close & order buttons
        const btnClose = document.getElementById('btn-close-supplier-modal');
        if (btnClose) {
            btnClose.onclick = () => { modal.style.display = 'none'; };
        }

        document.querySelectorAll('.btn-modal-order-supplier').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sName = btn.getAttribute('data-supplier');
                const stId = btn.getAttribute('data-store');
                const pId = btn.getAttribute('data-product');
                const q = parseInt(btn.getAttribute('data-qty'));
                const pr = parseFloat(btn.getAttribute('data-price'));

                btn.disabled = true;
                btn.textContent = 'Ordering...';

                try {
                    const res = await fetch('/api/action/approve-po', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            store_id: stId,
                            product_id: pId,
                            supplier_name: sName,
                            order_qty: q,
                            total_cost: pr * q
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        btn.style.background = '#10b981';
                        btn.style.color = '#000';
                        btn.textContent = '✓ Order Dispatched to ERP';
                        showToast(`PO ${data.order_details.po_number} dispatched to ${sName}!`);
                        setTimeout(() => { modal.style.display = 'none'; }, 1500);
                    }
                } catch (e) {
                    console.error('Modal order error:', e);
                    btn.disabled = false;
                    btn.textContent = 'Retry Order';
                }
            });
        });
    }

    function renderTransfersTable(data) {
        const tbody = document.querySelector('#table-transfers tbody');
        if (!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No matching transfer links generated.</td></tr>';
            return;
        }

        const rowsHtml = data.slice(0, 50).map(row => `
            <tr>
                <td><span class="badge badge-success">${row.City}</span></td>
                <td><strong>${row.Product_ID}</strong></td>
                <td><span class="pill-badge pill-info"><span class="dot"></span> ${row.From_Store} (Surplus)</span></td>
                <td><span class="pill-badge pill-warning"><span class="dot"></span> ${row.To_Store} (Deficit)</span></td>
                <td><strong>${row.Transfer_Qty}</strong> units</td>
                <td>
                    <button class="btn-action-sm btn-transfer-sm btn-approve-transfer" 
                        data-from="${row.From_Store}" 
                        data-to="${row.To_Store}" 
                        data-product="${row.Product_ID}" 
                        data-qty="${row.Transfer_Qty}" 
                        data-city="${row.City}">
                        Dispatch Truck
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.innerHTML = rowsHtml;
        bindTransferButtons();
    }

    function renderInventoryTable(data) {
        const tbody = document.querySelector('#table-inventory tbody');
        if (!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No matching inventory telemetry found.</td></tr>';
            return;
        }

        const rowsHtml = data.slice(0, 50).map(row => {
            let badgeClass = 'pill-success';
            let statusText = 'Optimal';
            const risk = row.Risk_State || 'OPTIMAL';

            // Calculate proportional operational stock health percentage & bar colors
            const targetMax = row.Safety_Stock ? Math.min(row.Maximum_Capacity || 9999, Math.round(row.Safety_Stock * 2.8)) : (row.Maximum_Capacity || 100);
            let fillPct = 65;
            let barColor = '#10b981'; // Green for Optimal

            if (risk === 'CRITICAL_STOCKOUT') {
                badgeClass = 'pill-danger';
                statusText = 'Critical Stockout';
                barColor = '#ef4444'; // Red
                fillPct = Math.max(6, Math.min(22, Math.round((row.Current_Stock / (row.Safety_Stock || 1)) * 25)));
            } else if (risk === 'REORDER_NEEDED') {
                badgeClass = 'pill-warning';
                statusText = 'Reorder Needed';
                barColor = '#f59e0b'; // Amber / Yellow
                fillPct = Math.max(25, Math.min(48, Math.round((row.Current_Stock / (row.Safety_Stock || 1)) * 45)));
            } else if (risk === 'OVERSTOCKED') {
                badgeClass = 'pill-info';
                statusText = 'Overstocked';
                barColor = '#00f2fe'; // Cyan / Blue (matches Overstocked badge)
                fillPct = Math.max(90, Math.min(100, Math.round((row.Current_Stock / targetMax) * 100)));
            } else {
                // OPTIMAL
                fillPct = Math.max(52, Math.min(85, Math.round((row.Current_Stock / targetMax) * 100)));
            }

            return `
                <tr>
                    <td><strong>${row.Store_Name || row.Store_ID}</strong> <br><small class="text-muted">${row.City}</small></td>
                    <td>${row.Product_Name || row.Product_ID}</td>
                    <td>${row.Category}</td>
                    <td><strong>${row.Current_Stock}</strong> units</td>
                    <td>${row.Safety_Stock} units</td>
                    <td>${row.Maximum_Capacity} units</td>
                    <td><span class="pill-badge ${badgeClass}"><span class="dot"></span> ${statusText}</span></td>
                    <td>
                        <div class="progress-bar-wrap">
                            <div class="progress-bar-fill" style="width: ${fillPct}%; background: ${barColor};"></div>
                        </div>
                    </td>
                    <td>
                        <button class="btn-action-sm btn-transfer-sm btn-direct-transfer" 
                            data-store="${row.Store_ID}" 
                            data-product="${row.Product_ID}" 
                            data-city="${row.City}">
                            Transfer Stock
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;
        bindDirectTransferButtons();
    }

    function bindDirectTransferButtons() {
        document.querySelectorAll('.btn-direct-transfer').forEach(btn => {
            btn.addEventListener('click', async () => {
                const store_id = btn.getAttribute('data-store');
                const product_id = btn.getAttribute('data-product');
                const city = btn.getAttribute('data-city');

                // Find matching transfer recommendation or simulate instant transfer truck
                const match = state.transfersData.find(t => t.Product_ID === product_id && (t.From_Store === store_id || t.To_Store === store_id));
                const from_store = match ? match.From_Store : store_id;
                const to_store = match ? match.To_Store : (store_id === 'BST-001' ? 'BST-002' : 'BST-001');
                const transfer_qty = match ? match.Transfer_Qty : 35;

                btn.disabled = true;
                btn.textContent = 'Dispatching...';

                try {
                    const res = await fetch('/api/action/approve-transfer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ from_store, to_store, product_id, transfer_qty, city })
                    });
                    const data = await res.json();
                    if (data.success) {
                        btn.style.background = '#10b981';
                        btn.style.color = '#000';
                        btn.textContent = '✓ Truck In Transit';
                        showToast(`Truck ${data.transfer_details.transfer_id} dispatched from ${from_store} to ${to_store}!`);
                        refreshLiveOperations();
                        fetchDispatchHistory();
                    }
                } catch (e) {
                    console.error('Direct transfer error:', e);
                    btn.disabled = false;
                    btn.textContent = 'Retry Transfer';
                }
            });
        });
    }


    /* ==========================================================================
       DROPDOWN FILTERS & EVENT SEARCH
       ========================================================================== */
    function populateDropdownFilters() {
        // Categories
        const categories = [...new Set(state.productsData.map(p => p.Category))].filter(Boolean);
        const catSelects = ['filter-rec-category', 'filter-inv-category'];
        catSelects.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = '<option value="all">All Categories</option>' + 
                    categories.map(c => `<option value="${c}">${c}</option>`).join('');
            }
        });

        // Dark Stores
        const storeSelects = ['filter-rec-store', 'filter-inv-store', 'chart-select-store'];
        storeSelects.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = '<option value="all">All 100 Dark Stores</option>' + 
                    state.storesData.map(s => `<option value="${s.Store_ID}">${s.Store_ID} - ${s.Locality} (${s.City})</option>`).join('');
            }
        });

        // Products dropdown for chart
        const chartProdEl = document.getElementById('chart-select-product');
        if (chartProdEl) {
            chartProdEl.innerHTML = state.productsData.map(p => 
                `<option value="${p.Product_ID}">${p.Product_ID} - ${p.Product_Name}</option>`
            ).join('');
        }

        // Bind PO Recommendation filter change handlers
        const recCatEl = document.getElementById('filter-rec-category');
        const recStoreEl = document.getElementById('filter-rec-store');
        const searchRecsEl = document.getElementById('search-recs');

        function triggerRecFilter() {
            const cat = recCatEl ? recCatEl.value : 'all';
            const st = recStoreEl ? recStoreEl.value : 'all';
            const q = searchRecsEl ? searchRecsEl.value : '';
            
            let filtered = state.recsData;
            if (cat !== 'all') filtered = filtered.filter(r => r.Category.toLowerCase() === cat.toLowerCase());
            if (st !== 'all') filtered = filtered.filter(r => r.Store_ID.toLowerCase() === st.toLowerCase());
            if (q) {
                const term = q.toLowerCase();
                filtered = filtered.filter(r => 
                    r.Product_Name.toLowerCase().includes(term) || 
                    r.Product_ID.toLowerCase().includes(term) || 
                    r.Store_ID.toLowerCase().includes(term) ||
                    r.Best_Supplier_Name.toLowerCase().includes(term)
                );
            }
            renderRecommendationsTable(filtered);
        }

        if (recCatEl) recCatEl.addEventListener('change', triggerRecFilter);
        if (recStoreEl) recStoreEl.addEventListener('change', triggerRecFilter);
        if (searchRecsEl) searchRecsEl.addEventListener('input', triggerRecFilter);

        // Bind Live Stock Telemetry & Transfers unified filter change handlers
        const searchInvEl = document.getElementById('search-inventory');
        const invRiskEl = document.getElementById('filter-inv-risk');
        const invStoreEl = document.getElementById('filter-inv-store');
        const invCatEl = document.getElementById('filter-inv-category');
        const transferCityEl = document.getElementById('filter-transfer-city');
        const btnResetInv = document.getElementById('btn-refresh-inventory');

        function triggerInventoryAndTransfersFilter() {
            const q = searchInvEl ? searchInvEl.value.toLowerCase() : '';
            const risk = invRiskEl ? invRiskEl.value : 'all';
            const store = invStoreEl ? invStoreEl.value : 'all';
            const cat = invCatEl ? invCatEl.value : 'all';
            const city = transferCityEl ? transferCityEl.value : 'all';

            // Filter Live Inventory Table
            let filteredInv = state.liveInventorySearch;
            if (risk !== 'all') filteredInv = filteredInv.filter(i => (i.Risk_State || 'OPTIMAL') === risk);
            if (store !== 'all') filteredInv = filteredInv.filter(i => i.Store_ID === store);
            if (cat !== 'all') filteredInv = filteredInv.filter(i => i.Category === cat);
            if (city !== 'all') filteredInv = filteredInv.filter(i => (i.City || '').toLowerCase() === city.toLowerCase());
            if (q) {
                filteredInv = filteredInv.filter(i => i.searchText.includes(q));
            }
            renderInventoryTable(filteredInv);

            // Filter Stock Transfers Table
            let filteredTransfers = state.transfersSearch;
            if (city !== 'all') filteredTransfers = filteredTransfers.filter(t => t.City === city);
            if (store !== 'all') filteredTransfers = filteredTransfers.filter(t => t.From_Store === store || t.To_Store === store);
            if (q) {
                filteredTransfers = filteredTransfers.filter(t => t.searchText.includes(q));
            }
            renderTransfersTable(filteredTransfers);
        }

        let inventorySearchTimer;
        if (searchInvEl) {
            searchInvEl.addEventListener('input', () => {
                clearTimeout(inventorySearchTimer);
                inventorySearchTimer = setTimeout(triggerInventoryAndTransfersFilter, 180);
            });
        }
        if (invRiskEl) invRiskEl.addEventListener('change', triggerInventoryAndTransfersFilter);
        if (invStoreEl) invStoreEl.addEventListener('change', triggerInventoryAndTransfersFilter);
        if (invCatEl) invCatEl.addEventListener('change', triggerInventoryAndTransfersFilter);
        if (transferCityEl) transferCityEl.addEventListener('change', triggerInventoryAndTransfersFilter);

        if (btnResetInv) {
            btnResetInv.addEventListener('click', () => {
                if (searchInvEl) searchInvEl.value = '';
                if (invRiskEl) invRiskEl.value = 'all';
                if (invStoreEl) invStoreEl.value = 'all';
                if (invCatEl) invCatEl.value = 'all';
                if (transferCityEl) transferCityEl.value = 'all';
                triggerInventoryAndTransfersFilter();
            });
        }
    }


    /* ==========================================================================
       ACTION DISPATCHERS (ERP PO & STOCK TRANSFER)
       ========================================================================== */
    function bindPOButtons() {
        document.querySelectorAll('.btn-approve-po').forEach(btn => {
            btn.addEventListener('click', async () => {
                const store_id = btn.getAttribute('data-store');
                const product_id = btn.getAttribute('data-product');
                const supplier_name = btn.getAttribute('data-supplier');
                const order_qty = parseInt(btn.getAttribute('data-qty'));
                const total_cost = parseFloat(btn.getAttribute('data-cost'));

                btn.disabled = true;
                btn.textContent = 'Dispatching...';

                try {
                    const res = await fetch('/api/action/approve-po', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ store_id, product_id, supplier_name, order_qty, total_cost })
                    });
                    const data = await res.json();
                    if (data.success) {
                        btn.style.background = '#10b981';
                        btn.style.color = '#000';
                        btn.textContent = '✓ Dispatched to ERP';
                        showToast(`PO ${data.order_details.po_number} sent to ${supplier_name}!`);
                        refreshLiveOperations();
                        fetchDispatchHistory();
                    }
                } catch (e) {
                    console.error('PO dispatch error:', e);
                    btn.disabled = false;
                    btn.textContent = 'Retry Dispatch';
                }
            });
        });
    }

    function bindTransferButtons() {
        document.querySelectorAll('.btn-approve-transfer').forEach(btn => {
            btn.addEventListener('click', async () => {
                const from_store = btn.getAttribute('data-from');
                const to_store = btn.getAttribute('data-to');
                const product_id = btn.getAttribute('data-product');
                const transfer_qty = parseInt(btn.getAttribute('data-qty'));
                const city = btn.getAttribute('data-city');

                btn.disabled = true;
                btn.textContent = 'Dispatching Truck...';

                try {
                    const res = await fetch('/api/action/approve-transfer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ from_store, to_store, product_id, transfer_qty, city })
                    });
                    const data = await res.json();
                    if (data.success) {
                        btn.style.background = '#10b981';
                        btn.style.color = '#000';
                        btn.textContent = '✓ Truck In Transit';
                        showToast(`Truck ${data.transfer_details.transfer_id} dispatched from ${from_store}!`);
                        refreshLiveOperations();
                        fetchDispatchHistory();
                    }
                } catch (e) {
                    console.error('Transfer dispatch error:', e);
                    btn.disabled = false;
                    btn.textContent = 'Retry Truck';
                }
            });
        });
    }

    async function fetchDispatchHistory() {
        try {
            const res = await fetch('/api/action/dispatch-history');
            if (res.ok) {
                const history = await res.json();
                renderHistoryLists(history);
            }
        } catch (e) {
            console.error('Fetch history error:', e);
        }
    }

    function renderHistoryLists(history) {
        const poContainer = document.getElementById('po-history-container');
        const trContainer = document.getElementById('transfer-history-container');

        if (poContainer) {
            if (!history.purchase_orders || history.purchase_orders.length === 0) {
                poContainer.innerHTML = '<div class="history-empty">No purchase orders dispatched yet in this session.</div>';
            } else {
                poContainer.innerHTML = history.purchase_orders.map(po => `
                    <div class="history-item">
                        <div class="history-item-header">
                            <span>${po.po_number}</span>
                            <span class="badge badge-success">${po.status}</span>
                        </div>
                        <div>Store: <strong>${po.store_id}</strong> | Product: <strong>${po.product_id}</strong></div>
                        <div>Supplier: ${po.supplier_name} | Qty: ${po.order_qty} units | Cost: ₹${po.total_cost.toLocaleString()}</div>
                        <small class="text-muted">${po.timestamp}</small>
                    </div>
                `).join('');
            }
        }

        if (trContainer) {
            if (!history.stock_transfers || history.stock_transfers.length === 0) {
                trContainer.innerHTML = '<div class="history-empty">No stock transfer trucks dispatched yet in this session.</div>';
            } else {
                trContainer.innerHTML = history.stock_transfers.map(tr => `
                    <div class="history-item">
                        <div class="history-item-header">
                            <span>${tr.transfer_id} (${tr.city})</span>
                            <span class="badge badge-accent">${tr.status} (${tr.eta})</span>
                        </div>
                        <div>Route: <strong>${tr.from_store}</strong> ➔ <strong>${tr.to_store}</strong></div>
                        <div>Product: ${tr.product_id} | Qty: ${tr.transfer_qty} units</div>
                        <small class="text-muted">${tr.timestamp}</small>
                    </div>
                `).join('');
            }
        }
    }


    /* ==========================================================================
       WHAT-IF SCENARIO SIMULATION STUDIO
       ========================================================================== */
    function initSimulators() {
        const surgeInput = document.getElementById('input-surge');
        const leadtimeInput = document.getElementById('input-leadtime');
        const serviceInput = document.getElementById('input-service');
        const valSurge = document.getElementById('val-surge');
        const valLeadtime = document.getElementById('val-leadtime');
        const valService = document.getElementById('val-service');
        const btnSim = document.getElementById('btn-run-simulation');

        if (surgeInput && valSurge) {
            surgeInput.addEventListener('input', () => valSurge.textContent = `+${surgeInput.value}%`);
        }
        if (leadtimeInput && valLeadtime) {
            leadtimeInput.addEventListener('input', () => valLeadtime.textContent = `+${leadtimeInput.value} Days`);
        }
        if (serviceInput && valService) {
            serviceInput.addEventListener('change', () => {
                const zMap = { '0.90': '90% (Z=1.28)', '0.95': '95% (Z=1.65)', '0.99': '99% (Z=2.05)' };
                valService.textContent = zMap[serviceInput.value] || serviceInput.value;
            });
        }

        if (btnSim) {
            btnSim.addEventListener('click', runSimulation);
        }
    }

    async function runSimulation() {
        const surge = parseFloat(document.getElementById('input-surge').value) || 0;
        const leadtime = parseInt(document.getElementById('input-leadtime').value) || 0;
        const service = parseFloat(document.getElementById('input-service').value) || 0.95;
        const festival = document.getElementById('input-festival').value;

        const container = document.getElementById('sim-summary-container');
        const tableWrap = document.getElementById('sim-table-wrap');

        if (container) {
            container.innerHTML = '<div class="sim-empty-state"><i data-lucide="cpu" class="spinning"></i><p>Computing dynamic simulation across 3,500 series...</p></div>';
        }

        try {
            const res = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    demand_surge_percent: surge,
                    lead_time_buffer_days: leadtime,
                    target_service_level: service,
                    festival_boost: festival
                })
            });

            const data = await res.json();
            if (res.ok) {
                renderSimulationResults(data);
            }
        } catch (e) {
            console.error('Simulation error:', e);
        }
    }

    function renderSimulationResults(data) {
        const container = document.getElementById('sim-summary-container');
        const tableWrap = document.getElementById('sim-table-wrap');

        if (!container) return;

        const summary = data.summary;
        const delta = summary.net_profit_delta;
        const deltaColor = delta >= 0 ? '#10b981' : '#ef4444';

        container.innerHTML = `
            <div class="sim-kpi-row">
                <div class="sim-kpi-card">
                    <h4>Simulated Order Volume</h4>
                    <p style="color:#00f2fe;">${summary.simulated_total_order_units.toLocaleString()} units</p>
                </div>
                <div class="sim-kpi-card">
                    <h4>Simulated Expected Profit</h4>
                    <p style="color:#10b981;">₹${(summary.simulated_total_profit_uplift / 100000).toFixed(2)} Lakhs</p>
                </div>
                <div class="sim-kpi-card">
                    <h4>Net Profit Delta vs Baseline</h4>
                    <p style="color:${deltaColor};">${delta >= 0 ? '+' : ''}₹${(delta / 100000).toFixed(2)} Lakhs</p>
                </div>
            </div>
        `;

        if (tableWrap) tableWrap.style.display = 'block';

        const tbody = document.querySelector('#table-sim-items tbody');
        if (tbody && data.sample_simulated_items) {
            tbody.innerHTML = data.sample_simulated_items.map(row => `
                <tr>
                    <td><strong>${row.Store_ID}</strong></td>
                    <td>${row.Product_Name}</td>
                    <td>${row.Baseline_Order_Qty} units</td>
                    <td><strong style="color:#00f2fe;">${row.Simulated_Order_Qty} units</strong></td>
                    <td>${row.Best_Supplier_Name}</td>
                    <td><strong style="color:#10b981;">₹${row.Simulated_Profit.toLocaleString()}</strong></td>
                </tr>
            `).join('');
        }
    }


    /* ==========================================================================
       FORECAST APEXCHARTS RENDERING
       ========================================================================== */
    function initForecastTab() {
        const btnRender = document.getElementById('btn-render-chart');
        if (btnRender) {
            btnRender.addEventListener('click', loadForecastChartData);
        }
    }

    async function loadForecastChartData() {
        const storeEl = document.getElementById('chart-select-store');
        const prodEl = document.getElementById('chart-select-product');

        const store_id = (storeEl && storeEl.value !== 'all') ? storeEl.value : 'BST-001';
        const product_id = prodEl ? prodEl.value : 'PROD-001';

        try {
            const res = await fetch(`/api/forecast-chart?store_id=${store_id}&product_id=${product_id}`);
            if (res.ok) {
                const chartData = await res.json();
                renderForecastCurve(chartData);
            }
        } catch (e) {
            console.error('Forecast chart error:', e);
        }
    }

    function renderForecastCurve(data) {
        if (typeof ApexCharts === 'undefined') return;

        const titleEl = document.getElementById('chart-curve-title');
        if (titleEl) {
            titleEl.textContent = `LightGBM 14-Day Forecast Curve: ${data.store_id} × ${data.product_id}`;
        }

        const options = {
            chart: { type: 'area', height: 380, toolbar: { show: true }, background: 'transparent' },
            theme: { mode: 'dark' },
            stroke: { curve: 'smooth', width: 3 },
            colors: ['#00f2fe'],
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.05, stops: [0, 90, 100] }
            },
            series: [{
                name: 'Forecasted Quantity (Units)',
                data: data.forecast
            }],
            xaxis: { categories: data.dates, title: { text: 'Future Forecast Date' } },
            yaxis: { title: { text: 'Daily Demand Units' } },
            grid: { borderColor: 'rgba(255, 255, 255, 0.05)' }
        };

        if (state.charts.curve) state.charts.curve.destroy();
        const curveEl = document.getElementById('chart-demand-curve');
        if (curveEl) {
            state.charts.curve = new ApexCharts(curveEl, options);
            state.charts.curve.render();
        }
    }

    initForecastTab();


    /* ==========================================================================
       LIGHTGBM PIPELINE EXECUTION & LOG STREAMER
       ========================================================================== */
    function initActionButtons() {
    const btnRun = document.getElementById('btn-run-pipeline');

    if (btnRun) {
        btnRun.addEventListener('click', triggerPipelineExecution);
    }

    const btnRefreshLogs = document.getElementById('btn-refresh-logs');

    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener('click', fetchPipelineLogs);
    }

    const btnClearLogs = document.getElementById('btn-clear-logs');

    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', () => {
            const logOut = document.getElementById('console-log-output');

            if (logOut) {
                logOut.textContent = 'Cleared view.';
            }
        });
    }

    // Audit Log refresh
    const btnRefreshHistory = document.getElementById('btn-refresh-history');

    if (btnRefreshHistory) {
        btnRefreshHistory.addEventListener('click', fetchDispatchHistory);
    }
}

    async function triggerPipelineExecution() {
        try {
            const res = await fetch('/api/run-pipeline', { method: 'POST' });
            const data = await res.json();
            showToast(data.message || 'Pipeline execution started!');
            switchTab('console');
            checkPipelineStatus();
        } catch (e) {
            console.error('Trigger pipeline error:', e);
        }
    }

    async function checkPipelineStatus() {
        try {
            const res = await fetch('/api/pipeline-status');
            if (res.ok) {
                const status = await res.json();
                state.isPipelineRunning = status.is_running;
                updatePipelineBadge(status);
                
                if (state.isPipelineRunning && state.activeTab === 'console') {
                    fetchPipelineLogs();
                }
            }
        } catch (e) {
            console.error('Pipeline status check error:', e);
        }
    }

    function updatePipelineBadge(status) {
        const badge = document.getElementById('pipeline-status-badge');
        const badgeText = document.getElementById('pipeline-badge-text');

        if (!badge || !badgeText) return;

        if (status.is_running) {
            badgeText.textContent = `Training Model (${status.elapsed_seconds}s)...`;
            badge.style.borderColor = '#00f2fe';
            badge.style.color = '#00f2fe';
        } else {
            badgeText.textContent = 'Engine Ready';
            badge.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            badge.style.color = '#f8fafc';
        }
    }

    async function fetchPipelineLogs() {
        const consoleEl = document.getElementById('console-log-output');
        if (!consoleEl) return;

        try {
            const res = await fetch('/api/pipeline-logs');
            if (res.ok) {
                const text = await res.text();
                consoleEl.textContent = text;
                consoleEl.scrollTop = consoleEl.scrollHeight;
            }
        } catch (e) {
            console.error('Log fetch error:', e);
        }
    }

    /* ==========================================================================
       MULTI-SUPPLIER COMPARISON & QUALITY MATRIX
       ========================================================================== */
    async function fetchSupplierCompare() {
        try {
            const res = await fetch('/api/suppliers/compare');
            if (res.ok) {
                state.supplierCompareData = await res.json();
                populateSupplierSKUDropdown();
                renderSupplierComparisonCards();
            }
        } catch (e) {
            console.error('Fetch supplier compare error:', e);
        }
    }

    function populateSupplierSKUDropdown() {
        const skuSelect = document.getElementById('supplier-sku-select');
        if (!skuSelect || !state.productsData.length) return;

        skuSelect.innerHTML = state.productsData.map(p => 
            `<option value="${p.Product_ID}">${p.Product_ID} - ${p.Product_Name} (${p.Category})</option>`
        ).join('');

        skuSelect.addEventListener('change', renderSupplierComparisonCards);
    }

    function renderSupplierComparisonCards() {
        const container = document.getElementById('supplier-cards-container');
        const skuSelect = document.getElementById('supplier-sku-select');
        if (!container) return;

        const selectedSKU = skuSelect ? skuSelect.value : 'PROD-001';
        const itemSuppliers = (state.supplierCompareData || []).filter(s => s.Product_ID === selectedSKU);

        if (!itemSuppliers.length) {
            container.innerHTML = '<div class="loading-cell" style="grid-column: span 3; text-align: center;">No supplier offers found for selected SKU.</div>';
            return;
        }

        itemSuppliers.sort((a, b) => (a.rank_in_product || 99) - (b.rank_in_product || 99));

        const cardsHtml = itemSuppliers.map((sup, idx) => {
            const isWinner = idx === 0 || sup.rank_in_product === 1;
            const rankBadge = isWinner ? 
                '<span class="badge badge-success" style="font-size:12px; padding:6px 12px;"><i data-lucide="crown"></i> #1 Optimal Recommendation</span>' : 
                `<span class="badge" style="background:rgba(255,255,255,0.08); color:var(--text-secondary);">Rank #${sup.rank_in_product || (idx+1)}</span>`;

            const cardBorder = isWinner ? 'border: 2px solid var(--color-emerald); box-shadow: var(--shadow-profit-glow);' : 'border: 1px solid var(--border-color);';
            const margin = sup.Selling_Price ? (((sup.Selling_Price - sup.Supplier_Price) / sup.Selling_Price) * 100).toFixed(1) : 25.0;

            return `
                <div class="glass-card" style="padding: 24px; position: relative; ${cardBorder}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                        <div>
                            <span class="badge badge-accent" style="margin-bottom:6px; display:inline-block;">${sup.Supplier_ID}</span>
                            <h3 style="font-size: 18px; font-weight: 700; font-family: var(--font-heading); color: var(--text-primary);">${sup.Supplier_Name}</h3>
                        </div>
                        ${rankBadge}
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; font-size: 13px;">
                        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                            <span style="color: var(--text-secondary);">Wholesale Price:</span>
                            <strong style="color: var(--color-emerald); font-size: 15px;">₹${sup.Supplier_Price} / unit</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                            <span style="color: var(--text-secondary);">Profit Margin:</span>
                            <strong style="color: var(--color-cyan);">+${margin}% Margin</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                            <span style="color: var(--text-secondary);">Delivery Speed:</span>
                            <strong style="color: ${sup.Lead_Time <= 2 ? '#10b981' : '#f59e0b'};">${sup.Lead_Time} Day${sup.Lead_Time > 1 ? 's' : ''} ${sup.Lead_Time <= 1 ? '(Express Fast)' : ''}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                            <span style="color: var(--text-secondary);">Quality Rating:</span>
                            <strong style="color: #fde047;">⭐ ${sup.Supplier_Rating} / 5.0 Quality</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                            <span style="color: var(--text-secondary);">AI Utility Score:</span>
                            <strong style="color: var(--color-purple);">${(sup.supplier_score || 0.85).toFixed(4)}</strong>
                        </div>
                    </div>

                    <button class="btn btn-full ${isWinner ? 'btn-glow' : 'btn-outline'} btn-approve-supplier-order"
                        data-supplier="${sup.Supplier_Name}"
                        data-product="${selectedSKU}"
                        data-price="${sup.Supplier_Price}">
                        ${isWinner ? '✓ Select & Order (Optimal Choice)' : 'Select & Order From Seller'}
                    </button>
                </div>
            `;
        }).join('');

        container.innerHTML = cardsHtml;
        if (window.lucide) lucide.createIcons();
        bindSupplierOrderButtons();
    }

    function bindSupplierOrderButtons() {
        document.querySelectorAll('.btn-approve-supplier-order').forEach(btn => {
            btn.addEventListener('click', async () => {
                const supplier_name = btn.getAttribute('data-supplier');
                const product_id = btn.getAttribute('data-product');
                const price = parseFloat(btn.getAttribute('data-price'));

                btn.disabled = true;
                btn.textContent = 'Dispatching Order...';

                try {
                    const res = await fetch('/api/action/approve-po', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            store_id: 'BST-001',
                            product_id: product_id,
                            supplier_name: supplier_name,
                            order_qty: 500,
                            total_cost: price * 500
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        btn.style.background = '#10b981';
                        btn.style.color = '#000';
                        btn.textContent = '✓ Order Dispatched to ERP';
                        showToast(`PO ${data.order_details.po_number} dispatched to seller ${supplier_name}!`);
                        fetchAllData();
                        fetchDispatchHistory();
                    }
                } catch (e) {
                    console.error('Supplier order error:', e);
                    btn.disabled = false;
                    btn.textContent = 'Retry Order';
                }
            });
        });
    }

    function initSupplierSliders() {
        const wPriceIn = document.getElementById('input-wprice');
        const wLeadIn = document.getElementById('input-wlead');
        const wRatingIn = document.getElementById('input-wrating');

        const valPrice = document.getElementById('val-wprice');
        const valLead = document.getElementById('val-wlead');
        const valRating = document.getElementById('val-wrating');
        const btnRecalc = document.getElementById('btn-recalc-suppliers');

        if (wPriceIn && valPrice) wPriceIn.addEventListener('input', () => valPrice.textContent = `${wPriceIn.value}%`);
        if (wLeadIn && valLead) wLeadIn.addEventListener('input', () => valLead.textContent = `${wLeadIn.value}%`);
        if (wRatingIn && valRating) wRatingIn.addEventListener('input', () => valRating.textContent = `${wRatingIn.value}%`);

        if (btnRecalc) {
            btnRecalc.addEventListener('click', async () => {
                const wp = parseFloat(wPriceIn.value) / 100.0;
                const wl = parseFloat(wLeadIn.value) / 100.0;
                const wr = parseFloat(wRatingIn.value) / 100.0;

                btnRecalc.disabled = true;
                btnRecalc.textContent = 'Recalculating Ranks...';

                try {
                    const res = await fetch('/api/suppliers/rank-custom', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ w_price: wp, w_lead_time: wl, w_rating: wr })
                    });
                    const data = await res.json();
                    if (res.ok && data.rankings) {
                        state.supplierCompareData = data.rankings;
                        renderSupplierComparisonCards();
                        showToast('Supplier rankings recalculated based on custom preference weights!');
                    }
                } catch (e) {
                    console.error('Recalc error:', e);
                } finally {
                    btnRecalc.disabled = false;
                    btnRecalc.textContent = 'Recalculate Optimal Supplier Ranks';
                }
            });
        }
    }


    function initDataIngestionModal() {
        const modal = document.getElementById('modal-data-ingest');
        const btnOpen = document.getElementById('btn-open-ingest-modal');
        const btnClose = document.getElementById('btn-close-ingest-modal');
        const btnSubmit = document.getElementById('btn-submit-ingest');

        const selectTarget = document.getElementById('select-ingest-target');
        const textareaCsv = document.getElementById('textarea-csv-data');
        const chkRetrain = document.getElementById('chk-auto-retrain');

        if (btnOpen && modal) {
            btnOpen.addEventListener('click', () => {
                modal.style.display = 'flex';
                if (window.lucide) lucide.createIcons();
            });
        }

        if (btnClose && modal) {
            btnClose.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        if (btnSubmit) {
            btnSubmit.addEventListener('click', async () => {
                const target = selectTarget ? selectTarget.value : 'sales';
                const csvContent = textareaCsv ? textareaCsv.value.trim() : '';
                const autoRetrain = chkRetrain ? chkRetrain.checked : true;

                if (!csvContent) {
                    alert('Please paste or enter raw CSV rows to ingest.');
                    return;
                }

                btnSubmit.disabled = true;
                btnSubmit.textContent = 'Ingesting Data...';

                try {
                    const res = await fetch('/api/data/ingest-csv', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            target_dataset: target,
                            raw_csv_content: csvContent,
                            auto_trigger_retrain: autoRetrain
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast(`Data Ingested! ${data.message}`);
                        if (textareaCsv) textareaCsv.value = '';
                        setTimeout(() => { modal.style.display = 'none'; }, 1500);

                        if (autoRetrain) {
                            switchTab('console');
                            fetchPipelineLogs();
                        }
                    } else {
                        alert(`Ingestion Error: ${data.detail || 'Failed to ingest CSV'}`);
                    }
                } catch (e) {
                    console.error('Ingestion error:', e);
                    alert('Failed to connect to backend server for CSV ingestion.');
                } finally {
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = '<i data-lucide="upload"></i> Append New Data & Retrain Model';
                    if (window.lucide) lucide.createIcons();
                }
            });
        }
    }


    /* Helper Notification Toast */
    function showToast(message) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                background: linear-gradient(135deg, #00f2fe, #4facfe);
                color: #040914;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 700;
                font-size: 13px;
                box-shadow: 0 8px 24px rgba(0,242,254,0.4);
                z-index: 9999;
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 4000);
    }

});
