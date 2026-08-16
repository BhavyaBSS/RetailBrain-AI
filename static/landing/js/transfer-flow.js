/**
 * RetailBrain AI — Phase 9: Inter-Store Stock Transfer Flow
 */
(function () {
    // Haversine formula calculation (distance in km)
    function calcHaversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(R * c * 10) / 10;
    }

    function initTransferModalContainer() {
        if (document.getElementById("transfer-modal-backdrop")) return;

        const backdrop = document.createElement("div");
        backdrop.id = "transfer-modal-backdrop";
        backdrop.className = "transfer-modal-backdrop";
        backdrop.innerHTML = `
            <div class="flow-modal" id="transfer-modal">
                <div class="flow-modal-header">
                    <div>
                        <h3 class="flow-modal-title" id="transfer-modal-title">Inter-Store Stock Transfer</h3>
                        <div class="flow-modal-subtitle" id="transfer-modal-subtitle">Rebalance inventory across dark stores</div>
                    </div>
                    <button class="drawer-close-btn" id="transfer-close-btn">&times;</button>
                </div>
                <div class="flow-modal-body">
                    <div class="transfer-split-container">
                        <!-- Left Half: Circular Radar Layout -->
                        <div class="radar-container" id="transfer-radar-container">
                            <div class="radar-heading">Distance comparison</div>
                            <div class="radar-scale" id="radar-scale-label">Nearest eligible stores</div>
                            <div class="radar-ring radar-ring-1"></div>
                            <div class="radar-ring radar-ring-2"></div>
                            <div class="radar-ring radar-ring-3"></div>
                            <div class="radar-center-node" id="radar-center-target">TARGET</div>
                            <div id="radar-nodes-wrapper"></div>
                        </div>

                        <!-- Right Half: Details & Form -->
                        <div class="transfer-form-panel">
                            <div class="recommendation-badge-box" id="transfer-rec-box">
                                <div class="rec-title">AI Recommendation</div>
                                <div class="rec-desc" id="transfer-rec-text">Calculating optimal nearby store...</div>
                            </div>

                            <div class="form-group">
                                <label class="form-label" id="transfer-store-select-label">Source Store (Fulfilling Store)</label>
                                <select class="form-select" id="transfer-source-select"></select>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Distance</label>
                                <div class="distance-metric" id="transfer-distance-val">0.0 km</div>
                                <div class="rec-desc" id="transfer-stock-context">Loading SKU stock levels...</div>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Transfer Quantity (Units)</label>
                                <input type="number" class="form-input" id="transfer-qty-input" min="1" max="500" value="25">
                                <div class="transfer-qty-warning" id="transfer-qty-warning" aria-live="polite"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="flow-modal-footer">
                    <button class="action-modal-cancel" id="transfer-cancel-btn" style="width: auto;">Cancel</button>
                    <button class="btn-confirm-action" id="transfer-confirm-btn">Confirm Transfer Dispatch &rarr;</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        document.getElementById("transfer-close-btn").onclick = hideTransferModal;
        document.getElementById("transfer-cancel-btn").onclick = hideTransferModal;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) hideTransferModal();
        };
    }

    let currentTargetStore = null;
    let currentSelectedProduct = null;
    let nearbyStoresList = [];
    let selectedSourceStore = null;
    let transferDirection = "INBOUND";

    const NEED_PRIORITY = {
        CRITICAL_STOCKOUT: 3,
        REORDER_NEEDED: 2,
        OPTIMAL: 1,
        OVERSTOCKED: 0,
    };

    function getInventoryForProduct(store, productId) {
        return fetch(`/api/inventory/live?store_id=${encodeURIComponent(store.Store_ID)}`)
            .then((res) => {
                if (!res.ok) throw new Error(`Inventory request failed with status ${res.status}`);
                return res.json();
            })
            .then((inventory) => {
                const sku = inventory.find((item) => item.Product_ID === productId);
                if (!sku) return null;

                const stock = Number(sku.Current_Stock) || 0;
                const reservedStock = Number(sku.Reserved_Stock) || 0;
                const availableStock = Number.isFinite(Number(sku.Available_Stock))
                    ? Number(sku.Available_Stock)
                    : Math.max(stock - reservedStock, 0);
                const safetyStock = Number(sku.Safety_Stock) || 0;
                const reorderPoint = Number(sku.Reorder_Point ?? sku.Safety_Stock) || 0;
                const maximumCapacity = Number(sku.Maximum_Capacity) || Number.MAX_SAFE_INTEGER;
                const riskState = sku.Risk_State || "OPTIMAL";
                const optimalEntryTarget = Math.floor(safetyStock) + 1;
                return {
                    ...store,
                    sku,
                    stock,
                    availableStock,
                    safetyStock,
                    reorderPoint,
                    maximumCapacity,
                    riskState,
                    needPriority: NEED_PRIORITY[riskState] ?? 0,
                    needUnits: riskState === "CRITICAL_STOCKOUT" || riskState === "REORDER_NEEDED"
                        ? Math.max(optimalEntryTarget - stock, 0)
                        : 0,
                    stockCoverage: safetyStock > 0 ? Math.round((availableStock / safetyStock) * 10) / 10 : null,
                    availableUnits: Math.max(availableStock - safetyStock, 0),
                };
            })
            .catch((error) => {
                console.warn(`Could not load ${productId} stock for ${store.Store_ID}:`, error);
                return null;
            });
    }

    function showTransferFlowModal(targetStore, product) {
        initTransferModalContainer();
        currentTargetStore = targetStore;
        currentSelectedProduct = product;
        transferDirection = product.Risk_State === "OVERSTOCKED" ? "OUTBOUND" : "INBOUND";

        document.getElementById("transfer-modal-title").textContent = `Transfer: ${product.Product_Name || product.Product_ID}`;
        document.getElementById("transfer-modal-subtitle").textContent = transferDirection === "OUTBOUND"
            ? `Source Store: ${targetStore.Store_Name} (${targetStore.City})`
            : `Destination Store: ${targetStore.Store_Name} (${targetStore.City})`;
        document.getElementById("radar-center-target").textContent = (targetStore.Locality || targetStore.Store_ID).slice(0, 8);
        document.getElementById("transfer-store-select-label").textContent = transferDirection === "OUTBOUND"
            ? "Destination Stores — nearest first"
            : "Source Stores — nearest first";
        document.getElementById("transfer-source-select").innerHTML = '<option>Loading SKU stock levels...</option>';
        document.getElementById("transfer-rec-text").textContent = "Checking nearby stores for this exact SKU...";
        document.getElementById("transfer-stock-context").textContent = "Loading SKU stock levels...";

        const backdrop = document.getElementById("transfer-modal-backdrop");
        backdrop.classList.add("is-open");

        // Fetch all stores to filter candidate stores in the same city
        fetch("/api/stores")
            .then((res) => res.json())
            .then((stores) => {
                const sameCityStores = stores
                    .filter((s) => s.City === targetStore.City && s.Store_ID !== targetStore.Store_ID)
                    .map((s) => {
                        const dist = calcHaversineDistance(targetStore.Latitude, targetStore.Longitude, s.Latitude, s.Longitude);
                        return { ...s, distance: dist };
                    });

                return Promise.all(sameCityStores.map((store) => getInventoryForProduct(store, product.Product_ID)));
            })
            .then((inventoryCandidates) => {
                const sourceAvailableStock = Number.isFinite(Number(product.Available_Stock))
                    ? Number(product.Available_Stock)
                    : Math.max((Number(product.Current_Stock) || 0) - (Number(product.Reserved_Stock) || 0), 0);
                const sourceSafetyStock = Number(product.Safety_Stock) || 0;
                const sourceSurplus = Math.max(sourceAvailableStock - sourceSafetyStock, 0);
                const candidates = inventoryCandidates
                    .filter(Boolean)
                    .map((store) => {
                        if (transferDirection !== "OUTBOUND") return store;
                        const roomBeforeOverstock = Math.max(
                            Math.floor(Math.min(store.maximumCapacity, store.safetyStock * 3.5) - store.stock),
                            0
                        );
                        return {
                            ...store,
                            transferNeed: Math.max(
                                0,
                                Math.min(store.needUnits, roomBeforeOverstock, sourceSurplus)
                            ),
                        };
                    })
                    .filter((store) => transferDirection === "OUTBOUND"
                        ? (store.riskState === "CRITICAL_STOCKOUT" || store.riskState === "REORDER_NEEDED") && store.transferNeed > 0
                        : store.availableUnits > 0)
                    // Distance is the primary order. Need/surplus breaks ties.
                    .sort((a, b) => a.distance - b.distance
                        || (transferDirection === "OUTBOUND"
                            ? b.needPriority - a.needPriority || b.transferNeed - a.transferNeed
                            : b.availableUnits - a.availableUnits));

                nearbyStoresList = candidates;
                renderRadarAndForm(candidates);
            })
            .catch((error) => {
                console.error("Unable to build transfer candidates:", error);
                document.getElementById("transfer-rec-text").textContent = "Could not load nearby SKU stock levels.";
            });
    }

    function renderRadarAndForm(candidates) {
        const wrapper = document.getElementById("radar-nodes-wrapper");
        const selectEl = document.getElementById("transfer-source-select");
        wrapper.innerHTML = "";
        selectEl.innerHTML = "";

        if (candidates.length === 0) {
            document.getElementById("transfer-rec-text").textContent = transferDirection === "OUTBOUND"
                ? "No same-city store has both lower stock and safe room to receive this SKU."
                : "No nearby store has transferable surplus for this SKU.";
            document.getElementById("transfer-stock-context").textContent = "No eligible transfer found.";
            document.getElementById("transfer-confirm-btn").disabled = true;
            return;
        }

        // The list is distance-first; stock need/surplus is still visible for
        // every candidate and is used to break equal-distance ties.
        const recommendedStore = candidates[0];
        selectedSourceStore = recommendedStore;
        document.getElementById("transfer-confirm-btn").disabled = false;

        document.getElementById("transfer-rec-text").textContent = transferDirection === "OUTBOUND"
            ? `Nearest lower-stock store: ${recommendedStore.Store_Name}, ${recommendedStore.distance} km away — stock ${recommendedStore.stock}, ${recommendedStore.stockCoverage ?? "—"}× safety coverage, can receive ${recommendedStore.transferNeed} units.`
            : `Nearest store with surplus: ${recommendedStore.Store_Name}, ${recommendedStore.distance} km away — ${recommendedStore.availableUnits} transferable units.`;

        // Render a true distance comparison. Radius is proportional to the
        // store's Haversine distance instead of placing every store on one
        // arbitrary circle. Percentage-based centering keeps the diagram
        // correct for every modal and viewport size.
        const visibleCandidates = candidates.slice(0, 12);
        const total = visibleCandidates.length;
        const maxDistance = Math.max(...visibleCandidates.map((store) => Number(store.distance) || 0), 1);
        const minimumRadius = 58;
        const maximumRadius = 148;
        const scaleLabel = document.getElementById("radar-scale-label");
        scaleLabel.textContent = `0–${maxDistance.toFixed(1)} km · ${total} nearest eligible store${total === 1 ? "" : "s"}`;

        for (let i = 0; i < total; i++) {
            const store = visibleCandidates[i];
            const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
            const relativeDistance = Math.max((Number(store.distance) || 0) / maxDistance, 0.12);
            const radius = minimumRadius + (maximumRadius - minimumRadius) * relativeDistance;
            const x = Math.round(radius * Math.cos(angle));
            const y = Math.round(radius * Math.sin(angle));

            const node = document.createElement("div");
            node.className = `radar-node ${store.Store_ID === recommendedStore.Store_ID ? "is-recommended is-selected" : ""}`;
            node.style.left = `calc(50% + ${x}px - 21px)`;
            node.style.top = `calc(50% + ${y}px - 21px)`;
            node.setAttribute("data-store-id", store.Store_ID);
            node.title = transferDirection === "OUTBOUND"
                ? `${store.Store_Name}: ${store.distance} km, stock ${store.stock}, can receive ${store.transferNeed}`
                : `${store.Store_Name}: ${store.distance} km, stock ${store.stock}, ${store.availableUnits} available`;
            node.innerHTML = `
                <span>${store.distance}</span><small>km</small>
                <div class="radar-node-label">${store.Locality || store.Store_ID} · ${transferDirection === "OUTBOUND" ? `receive ${store.transferNeed}` : `${store.availableUnits} free`}</div>
            `;

            node.onclick = () => selectSourceStore(store);
            wrapper.appendChild(node);
        }

        // Fill select dropdown
        selectEl.innerHTML = candidates
            .map(
                (s) => `
            <option value="${s.Store_ID}" ${s.Store_ID === recommendedStore.Store_ID ? "selected" : ""}>
                ${s.distance} km · ${s.Store_Name} · Stock ${s.stock} · ${transferDirection === "OUTBOUND" ? `Can receive ${s.transferNeed} · ${s.stockCoverage ?? "—"}× safety · ${s.riskState.replaceAll("_", " ")}` : `${s.availableUnits} transferable`}
            </option>
        `
            )
            .join("");

        selectEl.onchange = (e) => {
            const found = candidates.find((s) => s.Store_ID === e.target.value);
            if (found) selectSourceStore(found);
        };

        updateDistanceDisplay();

        document.getElementById("transfer-confirm-btn").onclick = executeTransferOrder;
    }

    function selectSourceStore(store) {
        selectedSourceStore = store;
        document.querySelectorAll(".radar-node").forEach((n) => {
            if (n.getAttribute("data-store-id") === store.Store_ID) {
                n.classList.add("is-selected");
            } else {
                n.classList.remove("is-selected");
            }
        });
        document.getElementById("transfer-source-select").value = store.Store_ID;
        updateDistanceDisplay();
    }

    function updateDistanceDisplay() {
        if (!selectedSourceStore) return;
        const destinationNeed = getDestinationOptimalNeed();
        document.getElementById("transfer-distance-val").textContent = `${selectedSourceStore.distance} km`;
        document.getElementById("transfer-stock-context").textContent = transferDirection === "OUTBOUND"
            ? `Current stock: ${selectedSourceStore.stock} · Available: ${selectedSourceStore.availableStock} · Needs ${destinationNeed} units to reach optimal · ${selectedSourceStore.riskState.replaceAll("_", " ")}`
            : `Source free stock: ${selectedSourceStore.availableUnits} units · Destination needs ${destinationNeed} units to reach optimal`;

        const sourceStock = getSourceStockMetrics();
        const recommendedQuantity = Math.min(destinationNeed, sourceStock.free);
        const quantityInput = document.getElementById("transfer-qty-input");
        quantityInput.max = Math.max(sourceStock.available, 1);
        quantityInput.value = Math.max(recommendedQuantity, 0);
        quantityInput.oninput = updateTransferQuantityWarning;
        updateTransferQuantityWarning();
    }

    function getDestinationOptimalNeed() {
        if (transferDirection === "OUTBOUND") {
            return Math.max(Number(selectedSourceStore.transferNeed) || 0, 0);
        }

        const stock = Number(currentSelectedProduct.Current_Stock) || 0;
        const safety = Number(currentSelectedProduct.Safety_Stock) || 0;
        const maximumCapacity = Number(currentSelectedProduct.Maximum_Capacity) || Number.MAX_SAFE_INTEGER;
        const riskState = currentSelectedProduct.Risk_State || "OPTIMAL";
        if (riskState !== "CRITICAL_STOCKOUT" && riskState !== "REORDER_NEEDED") return 0;
        const optimalEntryTarget = Math.floor(safety) + 1;
        return Math.max(Math.min(optimalEntryTarget - stock, maximumCapacity - stock), 0);
    }

    function getSourceStockMetrics() {
        if (transferDirection === "OUTBOUND") {
            const stock = Number(currentSelectedProduct.Current_Stock) || 0;
            const reserved = Number(currentSelectedProduct.Reserved_Stock) || 0;
            const apiAvailable = Number(currentSelectedProduct.Available_Stock);
            const available = Number.isFinite(apiAvailable) && currentSelectedProduct.Available_Stock !== ""
                ? apiAvailable
                : Math.max(stock - reserved, 0);
            const safety = Number(currentSelectedProduct.Safety_Stock) || 0;
            return { available, free: Math.max(available - safety, 0), safety };
        }

        return {
            available: Number(selectedSourceStore.availableStock) || 0,
            free: Number(selectedSourceStore.availableUnits) || 0,
            safety: Number(selectedSourceStore.safetyStock) || 0,
        };
    }

    function updateTransferQuantityWarning() {
        const quantityInput = document.getElementById("transfer-qty-input");
        const warning = document.getElementById("transfer-qty-warning");
        const confirmBtn = document.getElementById("transfer-confirm-btn");
        if (!quantityInput || !warning || !confirmBtn || !selectedSourceStore) return;

        const qty = Math.max(parseInt(quantityInput.value, 10) || 0, 0);
        const sourceStock = getSourceStockMetrics();
        const destinationNeed = getDestinationOptimalNeed();
        warning.className = "transfer-qty-warning";
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm Transfer Dispatch →";

        if (destinationNeed < 1) {
            warning.classList.add("is-error");
            warning.textContent = "This destination is already at its optimal stock level. No transfer is recommended.";
            confirmBtn.disabled = true;
            return;
        }

        if (qty < 1) {
            warning.classList.add("is-error");
            warning.textContent = "Enter at least 1 unit to transfer.";
            confirmBtn.disabled = true;
            return;
        }

        if (qty > sourceStock.available) {
            warning.classList.add("is-error");
            warning.textContent = `Cannot transfer ${qty} units. The source has only ${sourceStock.available} available units.`;
            confirmBtn.disabled = true;
            return;
        }

        const warnings = [];
        if (qty > destinationNeed) {
            const extraUnits = qty - destinationNeed;
            warnings.push(`The destination needs only ${destinationNeed} units to reach optimal; ${extraUnits} extra unit${extraUnits === 1 ? "" : "s"} may create excess stock.`);
        }
        if (qty > sourceStock.free) {
            const safetyUnitsUsed = qty - sourceStock.free;
            warnings.push(`Only ${sourceStock.free} units are free above safety stock; ${safetyUnitsUsed} unit${safetyUnitsUsed === 1 ? "" : "s"} would come from the safety buffer.`);
        }
        if (warnings.length) {
            warning.classList.add("is-warning");
            warning.textContent = `Warning: ${warnings.join(" ")}`;
            confirmBtn.textContent = "Transfer With Warning →";
            return;
        }

        warning.classList.add("is-safe");
        warning.textContent = `Recommended: ${qty} unit${qty === 1 ? "" : "s"}. This brings the destination to optimal stock while keeping the source above safety stock.`;
    }

    function executeTransferOrder() {
        if (!selectedSourceStore || !currentTargetStore || !currentSelectedProduct) return;

        const quantityInput = document.getElementById("transfer-qty-input");
        const qty = parseInt(quantityInput.value, 10) || 0;
        const sourceStock = getSourceStockMetrics();
        if (qty < 1 || qty > sourceStock.available) {
            updateTransferQuantityWarning();
            return;
        }
        const safetyUnitsUsed = Math.max(qty - sourceStock.free, 0);
        const fromStore = transferDirection === "OUTBOUND" ? currentTargetStore : selectedSourceStore;
        const toStore = transferDirection === "OUTBOUND" ? selectedSourceStore : currentTargetStore;
        const confirmBtn = document.getElementById("transfer-confirm-btn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Dispatching...";

        fetch("/api/action/approve-transfer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                from_store: fromStore.Store_ID,
                to_store: toStore.Store_ID,
                product_id: currentSelectedProduct.Product_ID,
                transfer_qty: qty,
                city: currentTargetStore.City,
            }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) {
                    const detail = typeof data.detail === "string" ? data.detail : "Transfer could not be approved.";
                    throw new Error(detail);
                }
                return data;
            })
            .then((data) => {
                hideTransferModal();
                showCinematicToast(
                    "Transfer Dispatched!",
                    `Successfully queued transfer of ${qty} units of ${currentSelectedProduct.Product_Name || currentSelectedProduct.Product_ID} from ${fromStore.Locality} to ${toStore.Locality} (${selectedSourceStore.distance} km).${safetyUnitsUsed ? ` Warning acknowledged: ${safetyUnitsUsed} unit${safetyUnitsUsed === 1 ? "" : "s"} came from the source safety buffer.` : ""}`
                );
                // Refresh live drawer inventory if open
                if (window.showStoreInventoryDrawer) {
                    window.showStoreInventoryDrawer(currentTargetStore);
                }
            })
            .catch((err) => {
                console.error("Transfer error:", err);
                alert(`Error approving transfer: ${err.message}`);
            })
            .finally(() => {
                confirmBtn.disabled = false;
                updateTransferQuantityWarning();
            });
    }

    function hideTransferModal() {
        const backdrop = document.getElementById("transfer-modal-backdrop");
        if (backdrop) backdrop.classList.remove("is-open");
    }

    // 4-5 Second Cinematic Toast Notification
    function showCinematicToast(title, message) {
        let container = document.getElementById("cinematic-toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "cinematic-toast-container";
            container.className = "cinematic-toast-container";
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.className = "cinematic-toast";
        toast.innerHTML = `
            <div class="toast-icon">✓</div>
            <div class="toast-body">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
        `;

        container.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    window.calcHaversineDistance = calcHaversineDistance;
    window.showTransferFlowModal = showTransferFlowModal;
    window.showCinematicToast = showCinematicToast;
})();
