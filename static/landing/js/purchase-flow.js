/**
 * RetailBrain AI — Phase 10: Supplier Purchase Order Flow & Recommendation Engine
 */
(function () {
    function initPurchaseModalContainer() {
        if (document.getElementById("purchase-modal-backdrop")) return;

        const backdrop = document.createElement("div");
        backdrop.id = "purchase-modal-backdrop";
        backdrop.className = "purchase-modal-backdrop";
        backdrop.innerHTML = `
            <div class="flow-modal" id="purchase-modal">
                <div class="flow-modal-header">
                    <div>
                        <h3 class="flow-modal-title" id="purchase-modal-title">Supplier Purchase Order</h3>
                        <div class="flow-modal-subtitle" id="purchase-modal-subtitle">Compare suppliers and dispatch PO</div>
                    </div>
                    <button class="drawer-close-btn" id="purchase-close-btn">&times;</button>
                </div>
                <div class="flow-modal-body">
                    <div class="recommendation-badge-box" id="purchase-rec-box" style="margin-bottom: 20px;">
                        <div class="rec-title">Graph Recommendation · Dijkstra</div>
                        <div class="rec-desc" id="purchase-rec-text">Building store-to-supplier cost graph...</div>
                    </div>

                    <div class="supplier-algorithm-panel">
                        <div class="supplier-graph" id="supplier-graph"></div>
                        <div class="dijkstra-calculation">
                            <div class="algorithm-heading">Dijkstra calculation</div>
                            <div class="algorithm-formula">Edge = base/unit + (distance × ₹0.015) + (lead days × ₹0.75) + ((5 − rating) × ₹0.40)</div>
                            <ol class="dijkstra-steps" id="dijkstra-steps"></ol>
                        </div>
                    </div>

                    <div class="supplier-table-container">
                        <table class="supplier-table">
                            <thead>
                                <tr>
                                    <th>Supplier Name</th>
                                    <th>Distance</th>
                                    <th>Base/Unit</th>
                                    <th>Freight/Unit</th>
                                    <th>Landed/Unit</th>
                                    <th>Profit/Unit</th>
                                    <th>Graph Cost</th>
                                </tr>
                            </thead>
                            <tbody id="supplier-table-tbody">
                                <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading supplier options...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="po-quantity-row">
                        <div>
                            <div class="form-label">Order Quantity (Units)</div>
                            <div style="font-size: 0.78rem; color: #94a3b8;" id="supplier-min-order-hint">Minimum Order Qty applies</div>
                        </div>
                        <input type="number" class="form-input" id="po-qty-input" min="10" max="2000" value="100" style="width: 140px;">
                    </div>
                </div>
                <div class="flow-modal-footer">
                    <button class="action-modal-cancel" id="purchase-cancel-btn" style="width: auto;">Cancel</button>
                    <button class="btn-confirm-action" id="purchase-confirm-btn">Dispatch Purchase Order &rarr;</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        document.getElementById("purchase-close-btn").onclick = hidePurchaseModal;
        document.getElementById("purchase-cancel-btn").onclick = hidePurchaseModal;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) hidePurchaseModal();
        };
    }

    let currentTargetStore = null;
    let currentSelectedProduct = null;
    let supplierList = [];
    let selectedSupplier = null;
    let dijkstraTrace = [];

    const FREIGHT_PER_UNIT_KM = 0.015;
    const LEAD_TIME_PENALTY_PER_DAY = 0.75;
    const RATING_RISK_PENALTY = 0.4;

    function formatMoney(value) {
        return `₹${Number(value || 0).toFixed(2)}`;
    }

    function runDijkstra(storeNode, suppliers) {
        const graph = new Map([[storeNode, []]]);
        suppliers.forEach((supplier) => {
            graph.get(storeNode).push({ node: supplier.Supplier_ID, weight: supplier.edgeWeight });
            graph.set(supplier.Supplier_ID, []);
        });

        const distances = new Map([...graph.keys()].map((node) => [node, Infinity]));
        const unsettled = new Set(graph.keys());
        const trace = [];
        distances.set(storeNode, 0);

        while (unsettled.size) {
            const current = [...unsettled].reduce((best, node) => {
                return best === null || distances.get(node) < distances.get(best) ? node : best;
            }, null);
            if (current === null || !Number.isFinite(distances.get(current))) break;
            unsettled.delete(current);

            (graph.get(current) || []).forEach((edge) => {
                if (!unsettled.has(edge.node)) return;
                const candidateCost = distances.get(current) + edge.weight;
                if (candidateCost < distances.get(edge.node)) {
                    distances.set(edge.node, candidateCost);
                    const supplier = suppliers.find((item) => item.Supplier_ID === edge.node);
                    trace.push({ supplierName: supplier.Supplier_Name, cost: candidateCost });
                }
            });
        }

        return { distances, trace };
    }

    function showPurchaseFlowModal(targetStore, product) {
        initPurchaseModalContainer();
        currentTargetStore = targetStore;
        currentSelectedProduct = product;

        document.getElementById("purchase-modal-title").textContent = `Purchase PO: ${product.Product_Name || product.Product_ID}`;
        document.getElementById("purchase-modal-subtitle").textContent = `Destination Store: ${targetStore.Store_Name} (${targetStore.City})`;

        const backdrop = document.getElementById("purchase-modal-backdrop");
        backdrop.classList.add("is-open");

        const tbody = document.getElementById("supplier-table-tbody");
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Fetching supplier comparison data...</td></tr>';

        fetch(`/api/suppliers/compare?product_id=${encodeURIComponent(product.Product_ID)}`)
            .then((res) => res.json())
            .then((suppliers) => {
                if (!suppliers || suppliers.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ff4757; padding: 20px;">No suppliers found for this product.</td></tr>';
                    return;
                }

                // Supplier coordinates come directly from suppliers.csv via
                // the existing comparison endpoint.
                supplierList = suppliers.map((sup) => {
                    const sLat = Number(sup.Supplier_Latitude);
                    const sLon = Number(sup.Supplier_Longitude);
                    const dist = window.calcHaversineDistance && Number.isFinite(sLat) && Number.isFinite(sLon)
                        ? window.calcHaversineDistance(Number(targetStore.Latitude), Number(targetStore.Longitude), sLat, sLon)
                        : null;
                    return { ...sup, distance: dist };
                });

                calculateSupplierScores();
                renderSupplierTable();
            })
            .catch((err) => {
                console.error("Supplier fetch error:", err);
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ff4757; padding: 20px;">Failed to load supplier data.</td></tr>';
            });
    }

    function calculateSupplierScores() {
        if (supplierList.length === 0) return;

        const sellingPrice = Number(currentSelectedProduct.Selling_Price || supplierList[0].Selling_Price) || 0;
        supplierList.forEach((s) => {
            const distance = Number.isFinite(Number(s.distance)) ? Number(s.distance) : 0;
            s.freightPerUnit = distance * FREIGHT_PER_UNIT_KM;
            s.landedUnitCost = Number(s.Supplier_Price) + s.freightPerUnit;
            s.leadPenalty = Number(s.Lead_Time || 0) * LEAD_TIME_PENALTY_PER_DAY;
            s.reliabilityPenalty = Math.max(5 - Number(s.Supplier_Rating || 4), 0) * RATING_RISK_PENALTY;
            s.edgeWeight = s.landedUnitCost + s.leadPenalty + s.reliabilityPenalty;
            s.profitPerUnit = sellingPrice - s.landedUnitCost;
            s.adjustedProfitPerUnit = sellingPrice - s.edgeWeight;
        });

        const storeNode = currentTargetStore.Store_Name || currentTargetStore.Store_ID;
        const result = runDijkstra(storeNode, supplierList);
        dijkstraTrace = result.trace.sort((a, b) => a.cost - b.cost);
        supplierList.forEach((supplier) => {
            supplier.graphCost = result.distances.get(supplier.Supplier_ID);
        });
        supplierList.sort((a, b) => a.graphCost - b.graphCost || b.profitPerUnit - a.profitPerUnit);
        selectedSupplier = supplierList[0];
    }

    function renderSupplierTable() {
        const tbody = document.getElementById("supplier-table-tbody");
        if (!tbody || supplierList.length === 0) return;

        const rec = supplierList[0];
        document.getElementById("purchase-rec-text").textContent = `Shortest adjusted-cost path: ${currentTargetStore.Store_Name} → ${rec.Supplier_Name}. Landed cost ${formatMoney(rec.landedUnitCost)}/unit, expected profit ${formatMoney(rec.profitPerUnit)}/unit, graph cost ${formatMoney(rec.graphCost)}.`;

        renderSupplierGraph(rec);
        document.getElementById("dijkstra-steps").innerHTML = dijkstraTrace
            .map((step, index) => `<li><b>Relax ${step.supplierName}</b>: path cost = ${formatMoney(step.cost)} ${index === 0 ? '<span class="algorithm-winner">← minimum</span>' : ''}</li>`)
            .join("");

        tbody.innerHTML = supplierList
            .map((s, idx) => {
                const isRec = idx === 0;
                const isSel = selectedSupplier && selectedSupplier.Supplier_ID === s.Supplier_ID;

                return `
                    <tr class="${isRec ? 'is-recommended' : ''} ${isSel ? 'is-selected' : ''}" data-sup-id="${s.Supplier_ID}">
                        <td>
                            <b>${s.Supplier_Name}</b>
                            ${isRec ? '<span class="table-rec-badge">&#9733; Recommended</span>' : ''}
                        </td>
                        <td>${Number.isFinite(Number(s.distance)) ? `${s.distance} km` : "Unknown"}</td>
                        <td class="supplier-price">${formatMoney(s.Supplier_Price)}</td>
                        <td>${formatMoney(s.freightPerUnit)}</td>
                        <td>${formatMoney(s.landedUnitCost)}</td>
                        <td class="supplier-profit ${s.profitPerUnit >= 0 ? "is-positive" : "is-negative"}">${formatMoney(s.profitPerUnit)}</td>
                        <td>${formatMoney(s.graphCost)}</td>
                    </tr>
                `;
            })
            .join("");

        // Add row selection listener
        tbody.querySelectorAll("tr").forEach((tr) => {
            tr.onclick = () => {
                const supId = tr.getAttribute("data-sup-id");
                const found = supplierList.find((s) => s.Supplier_ID === supId);
                if (found) {
                    selectedSupplier = found;
                    renderSupplierTable();
                }
            };
        });

        if (selectedSupplier) {
            document.getElementById("po-qty-input").value = Math.max(100, selectedSupplier.Minimum_Order || 10);
            document.getElementById("supplier-min-order-hint").textContent = `Min order for ${selectedSupplier.Supplier_Name}: ${selectedSupplier.Minimum_Order || 10} units`;
        }

        document.getElementById("purchase-confirm-btn").onclick = executePurchaseOrder;
    }

    function renderSupplierGraph(recommendedSupplier) {
        const graph = document.getElementById("supplier-graph");
        graph.innerHTML = `
            <div class="graph-store-node">${currentTargetStore.Locality || currentTargetStore.Store_ID}</div>
            <div class="graph-edge-column">
                ${supplierList.map((supplier) => `
                    <div class="graph-path ${supplier.Supplier_ID === recommendedSupplier.Supplier_ID ? "is-winner" : ""}">
                        <span class="graph-edge-line"></span>
                        <span class="graph-edge-cost">${formatMoney(supplier.graphCost)}</span>
                        <span class="graph-supplier-node">${supplier.Supplier_Name}<small>${supplier.distance} km · ${formatMoney(supplier.profitPerUnit)} profit/unit</small></span>
                    </div>
                `).join("")}
            </div>
        `;
    }

    function executePurchaseOrder() {
        if (!selectedSupplier || !currentTargetStore || !currentSelectedProduct) return;

        const qty = parseInt(document.getElementById("po-qty-input").value) || 100;
        const totalCost = Math.round(qty * Number(selectedSupplier.Supplier_Price) * 100) / 100;
        const confirmBtn = document.getElementById("purchase-confirm-btn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Dispatching PO...";

        fetch("/api/action/approve-po", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                store_id: currentTargetStore.Store_ID,
                product_id: currentSelectedProduct.Product_ID,
                supplier_name: selectedSupplier.Supplier_Name,
                order_qty: qty,
                total_cost: totalCost,
            }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) {
                    const details = Array.isArray(data.detail)
                        ? data.detail.map((item) => item.msg).join(", ")
                        : data.detail || "Purchase order was rejected";
                    throw new Error(details);
                }
                return data;
            })
            .then((data) => {
                hidePurchaseModal();
                if (window.showCinematicToast) {
                    window.showCinematicToast(
                        "Purchase Order Dispatched!",
                        `${data.order_details && data.order_details.po_number ? `${data.order_details.po_number}: ` : ""}${qty} units of ${currentSelectedProduct.Product_Name || currentSelectedProduct.Product_ID} ordered from ${selectedSupplier.Supplier_Name} (${formatMoney(totalCost)} total).`
                    );
                }
                // Refresh live drawer inventory if open
                if (window.showStoreInventoryDrawer) {
                    window.showStoreInventoryDrawer(currentTargetStore);
                }
            })
            .catch((err) => {
                console.error("PO error:", err);
                alert("Error approving purchase order.");
            })
            .finally(() => {
                confirmBtn.disabled = false;
                confirmBtn.textContent = "Dispatch Purchase Order \u2192";
            });
    }

    function hidePurchaseModal() {
        const backdrop = document.getElementById("purchase-modal-backdrop");
        if (backdrop) backdrop.classList.remove("is-open");
    }

    window.showPurchaseFlowModal = showPurchaseFlowModal;
})();
