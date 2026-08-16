/**
 * RetailBrain AI — Store Inventory SKU Grid & Action Choice Modal (Phases 7 & 8)
 */
(function () {
    let currentStore = null;
    let storeInventoryData = [];
    let activeFilter = "ALL";
    let searchQuery = "";

    // Build Drawer HTML structure dynamically
    function initDrawerContainer() {
        if (document.getElementById("inventory-drawer-backdrop")) return;

        const backdrop = document.createElement("div");
        backdrop.id = "inventory-drawer-backdrop";
        backdrop.className = "inventory-drawer-backdrop";
        backdrop.innerHTML = `
            <div class="inventory-drawer" id="inventory-drawer">
                <div class="drawer-header">
                    <div class="drawer-header-top">
                        <div>
                            <h2 class="drawer-title" id="drawer-store-name">Store Inventory</h2>
                            <div class="drawer-subtitle" id="drawer-store-locality">Locality</div>
                        </div>
                        <button class="drawer-close-btn" id="drawer-close-btn">&times;</button>
                    </div>
                    <div class="drawer-stats-bar">
                        <div class="stat-item">
                            <span class="stat-label">Health Score</span>
                            <span class="stat-value" id="drawer-stat-health">--</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Reorder Alerts</span>
                            <span class="stat-value alert" id="drawer-stat-alerts">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Total SKUs</span>
                            <span class="stat-value" id="drawer-stat-total-skus">35</span>
                        </div>
                    </div>
                </div>

                <div class="drawer-controls">
                    <input type="text" class="sku-search-input" id="sku-search-input" placeholder="Search product name or category...">
                    <div class="sku-filter-pills">
                        <button class="filter-pill active" data-filter="ALL">All SKUs</button>
                        <button class="filter-pill pill-critical" data-filter="CRITICAL">Reorder Required</button>
                        <button class="filter-pill pill-optimal" data-filter="OPTIMAL">Optimal</button>
                        <button class="filter-pill pill-overstocked" data-filter="OVERSTOCKED">Overstocked</button>
                    </div>
                </div>

                <div class="drawer-body" id="drawer-sku-body">
                    <div class="sku-grid" id="sku-grid-container"></div>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        // Action Choice Modal Backdrop
        const choiceBackdrop = document.createElement("div");
        choiceBackdrop.id = "action-modal-backdrop";
        choiceBackdrop.className = "action-modal-backdrop";
        choiceBackdrop.innerHTML = `
            <div class="action-modal" id="action-modal">
                <div class="action-modal-header">
                    <h3 class="action-modal-title" id="action-modal-product-name">Optimize Inventory</h3>
                    <div class="action-modal-subtitle" id="action-modal-store-name">Store Name</div>
                </div>
                <div class="action-options-grid">
                    <div class="action-option-card" id="option-transfer-card">
                        <div class="option-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                        </div>
                        <div class="option-details">
                            <div class="option-title">Inter-Store Stock Transfer</div>
                            <div class="option-desc">Rebalance stock from a nearby dark store in the same city with surplus stock. Fast & lower cost.</div>
                        </div>
                        <div class="option-arrow">&rarr;</div>
                    </div>

                    <div class="action-option-card" id="option-purchase-card">
                        <div class="option-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                        </div>
                        <div class="option-details">
                            <div class="option-title">Supplier Purchase Order</div>
                            <div class="option-desc">Dispatch a new purchase order directly to an approved supplier. Filter by price, lead time & rating.</div>
                        </div>
                        <div class="option-arrow">&rarr;</div>
                    </div>
                </div>
                <button class="action-modal-cancel" id="action-modal-cancel-btn">Cancel</button>
            </div>
        `;
        document.body.appendChild(choiceBackdrop);

        // Bind events
        document.getElementById("drawer-close-btn").addEventListener("click", hideDrawer);
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) hideDrawer();
        });

        document.getElementById("sku-search-input").addEventListener("input", (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            renderSKUGrid();
        });

        document.querySelectorAll(".filter-pill").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                activeFilter = btn.getAttribute("data-filter");
                renderSKUGrid();
            });
        });

        document.getElementById("action-modal-cancel-btn").addEventListener("click", hideChoiceModal);
        choiceBackdrop.addEventListener("click", (e) => {
            if (e.target === choiceBackdrop) hideChoiceModal();
        });
    }

    function showStoreInventoryDrawer(store) {
        initDrawerContainer();
        currentStore = store;

        document.getElementById("drawer-store-name").textContent = store.Store_Name;
        document.getElementById("drawer-store-locality").textContent = `${store.Locality}, ${store.City}`;
        document.getElementById("drawer-stat-health").textContent = `${store.health_score ?? 100}%`;
        document.getElementById("drawer-stat-alerts").textContent = store.reorder_alerts_count || 0;

        const gridContainer = document.getElementById("sku-grid-container");
        gridContainer.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 20px;">Loading live inventory data...</div>';

        document.getElementById("inventory-drawer-backdrop").classList.add("is-open");

        fetch(`/api/inventory/live?store_id=${encodeURIComponent(store.Store_ID)}`)
            .then((res) => res.json())
            .then((data) => {
                storeInventoryData = data;
                document.getElementById("drawer-stat-total-skus").textContent = data.length;
                renderSKUGrid();
            })
            .catch((err) => {
                console.error("Error fetching store inventory:", err);
                gridContainer.innerHTML = '<div style="color: #ff4757; padding: 20px;">Failed to load live inventory data.</div>';
            });
    }

    function hideDrawer() {
        const backdrop = document.getElementById("inventory-drawer-backdrop");
        if (backdrop) backdrop.classList.remove("is-open");
    }

    function renderSKUGrid() {
        const gridContainer = document.getElementById("sku-grid-container");
        if (!gridContainer) return;

        let filtered = storeInventoryData.filter((item) => {
            const matchesSearch =
                !searchQuery ||
                (item.Product_Name || "").toLowerCase().includes(searchQuery) ||
                (item.Category || "").toLowerCase().includes(searchQuery);

            if (!matchesSearch) return false;

            const state = item.Risk_State;
            if (activeFilter === "CRITICAL") return state === "CRITICAL_STOCKOUT" || state === "REORDER_NEEDED";
            if (activeFilter === "OPTIMAL") return state === "OPTIMAL";
            if (activeFilter === "OVERSTOCKED") return state === "OVERSTOCKED";
            return true;
        });

        if (filtered.length === 0) {
            gridContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">No matching products found.</div>';
            return;
        }

        gridContainer.innerHTML = filtered
            .map((item) => {
                const stock = item.Current_Stock || 0;
                const maxCap = item.Maximum_Capacity || 100;
                const safety = item.Safety_Stock || 0;
                const pct = Math.min(100, Math.round((stock / maxCap) * 100));
                const state = item.Risk_State || "OPTIMAL";
                const stateLabel = state.replace("_", " ");
                const isOverstocked = state === "OVERSTOCKED";

                return `
                    <div class="sku-card state-${state}" data-product-id="${item.Product_ID}">
                        <div>
                            <div class="sku-header">
                                <div class="sku-name">${item.Product_Name || item.Product_ID}</div>
                                <span class="risk-badge badge-${state}">${stateLabel}</span>
                            </div>
                            <div class="sku-category">${item.Category || "Retail SKU"}</div>
                        </div>
                        <div>
                            <div class="sku-progress-container">
                                <div class="sku-progress-labels">
                                    <span>Stock: <b>${stock}</b></span>
                                    <span>Cap: ${maxCap}</span>
                                </div>
                                <div class="sku-progress-bar">
                                    <div class="sku-progress-fill fill-${state}" style="width: ${pct}%"></div>
                                </div>
                            </div>
                            <div class="sku-card-footer">
                                <span class="sku-stock-count">Safety: ${safety}</span>
                                <button class="sku-action-btn" onclick="window.handleSKUAction('${item.Product_ID}', '${(item.Product_Name || '').replace(/'/g, "\\'")}')">
                                    ${isOverstocked ? "Transfer Overstock" : "Optimize"} &rarr;
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            })
            .join("");
    }

    // Phase 8: Action Choice Modal
    let selectedSKU = null;

    window.handleSKUAction = function (productId, productName) {
        const sku = storeInventoryData.find((item) => item.Product_ID === productId)
            || { Product_ID: productId, Product_Name: productName };
        if (sku.Risk_State === "OVERSTOCKED") {
            if (window.showTransferFlowModal) {
                window.showTransferFlowModal(currentStore, sku);
            }
            return;
        }
        window.openChoiceModal(productId, productName);
    };

    window.openChoiceModal = function (productId, productName) {
        selectedSKU = storeInventoryData.find((i) => i.Product_ID === productId) || { Product_ID: productId, Product_Name: productName };

        const isOverstocked = selectedSKU.Risk_State === "OVERSTOCKED";
        const purchaseCard = document.getElementById("option-purchase-card");
        const transferCard = document.getElementById("option-transfer-card");

        // Overstock must be redistributed, never purchased again.
        purchaseCard.hidden = isOverstocked;
        purchaseCard.style.display = isOverstocked ? "none" : "";
        purchaseCard.setAttribute("aria-hidden", isOverstocked ? "true" : "false");
        transferCard.querySelector(".option-title").textContent = isOverstocked
            ? "Transfer Overstock to a Needy Store"
            : "Inter-Store Stock Transfer";
        transferCard.querySelector(".option-desc").textContent = isOverstocked
            ? "Send surplus units to nearby stores that are critical or below their reorder level."
            : "Rebalance stock from a nearby dark store in the same city with surplus stock. Fast & lower cost.";

        document.getElementById("action-modal-product-name").textContent = selectedSKU.Product_Name || productId;
        document.getElementById("action-modal-store-name").textContent = currentStore ? currentStore.Store_Name : "Selected Store";

        const backdrop = document.getElementById("action-modal-backdrop");
        backdrop.classList.add("is-open");

        document.getElementById("option-transfer-card").onclick = () => {
            hideChoiceModal();
            if (window.showTransferFlowModal) {
                window.showTransferFlowModal(currentStore, selectedSKU);
            }
        };

        document.getElementById("option-purchase-card").onclick = () => {
            hideChoiceModal();
            if (window.showPurchaseFlowModal) {
                window.showPurchaseFlowModal(currentStore, selectedSKU);
            }
        };
    };

    function hideChoiceModal() {
        const backdrop = document.getElementById("action-modal-backdrop");
        if (backdrop) backdrop.classList.remove("is-open");
    }

    window.showStoreInventoryDrawer = showStoreInventoryDrawer;
    window.hideStoreInventoryDrawer = hideDrawer;
})();
