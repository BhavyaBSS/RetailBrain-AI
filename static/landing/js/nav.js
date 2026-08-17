/**
 * RetailBrain AI — Phase 11 Global Navigation Header & Command Modals
 */
(function () {
    const hiddenAuditStorageKey = "retailbrain-hidden-completed-audits";
    let auditCountdownTimer = null;
    let auditRefreshTimer = null;
    let currentAuditHistory = [];
    let showRemovedAuditRows = false;

    function initGlobalNav() {
        const rightContainer = document.getElementById("header-nav-right");
        if (!rightContainer) return;
        if (document.getElementById("nav-modal-backdrop")) return;

        rightContainer.innerHTML = `
            <nav class="global-nav-bar">
                <a href="/" class="nav-link-btn" id="nav-globe">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    Globe
                </a>
                <a href="/india-map" class="nav-link-btn active" id="nav-map">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 6v14l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v14M16 6v14"/></svg>
                    Network Map
                </a>
                <button class="nav-link-btn" id="nav-kpis-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    Executive KPIs
                </button>
                <button class="nav-link-btn" id="nav-forecast-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
                    Forecasting
                </button>
                <button class="nav-link-btn" id="nav-history-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    Audit Log
                </button>
                <a href="/dashboard" class="nav-link-btn btn-dashboard-link">
                    Classic Dashboard &rarr;
                </a>
            </nav>
        `;

        // Modals container
        const modalBackdrop = document.createElement("div");
        modalBackdrop.id = "nav-modal-backdrop";
        modalBackdrop.className = "nav-modal-backdrop";
        modalBackdrop.innerHTML = `
            <div class="nav-modal-content">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 class="flow-modal-title" id="nav-modal-title">Executive KPIs</h3>
                    <button class="drawer-close-btn" id="nav-modal-close-btn">&times;</button>
                </div>
                <div id="nav-modal-body" style="overflow-y: auto; flex: 1;"></div>
            </div>
        `;
        document.body.appendChild(modalBackdrop);

        document.getElementById("nav-modal-close-btn").onclick = hideNavModal;
        modalBackdrop.onclick = (e) => {
            if (e.target === modalBackdrop) hideNavModal();
        };

        // Bind KPI modal trigger
        document.getElementById("nav-kpis-btn").onclick = openKPIsModal;
        document.getElementById("nav-forecast-btn").onclick = openForecastModal;
        document.getElementById("nav-history-btn").onclick = openHistoryModal;
    }

    function requireSuccessfulResponse(response, label) {
        if (!response.ok) throw new Error(`${label} request failed with status ${response.status}`);
        return response.json();
    }

    function formatIndianCurrency(value) {
        const amount = Number(value) || 0;
        if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
        if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(2)} Lakhs`;
        return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    }

    function openKPIsModal() {
        stopAuditCountdown();
        document.querySelector(".nav-modal-content").classList.remove("is-wide");
        document.querySelector(".nav-modal-content").classList.remove("is-audit-wide");
        document.getElementById("nav-modal-title").textContent = "Executive Inventory KPIs";
        const body = document.getElementById("nav-modal-body");
        body.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 20px;">Fetching executive KPI summary...</div>';

        const backdrop = document.getElementById("nav-modal-backdrop");
        backdrop.classList.add("is-open");

        fetch("/api/summary")
            .then((res) => requireSuccessfulResponse(res, "Executive KPI"))
            .then((data) => {
                const wape = Number(data.forecast_model_wape_overall ?? 0);
                const forecastAccuracy = Math.max(0, (1 - wape) * 100);
                body.innerHTML = `
                    <div class="kpi-cards-grid">
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Total Active Stores</div>
                            <div class="kpi-card-number cyan">${Number(data.total_stores ?? 0).toLocaleString("en-IN")}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Product Catalog SKUs</div>
                            <div class="kpi-card-number">${Number(data.total_products ?? 0).toLocaleString("en-IN")}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Historical Revenue</div>
                            <div class="kpi-card-number emerald">${formatIndianCurrency(data.total_historical_revenue)}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Historical Profit</div>
                            <div class="kpi-card-number emerald">${formatIndianCurrency(data.total_historical_profit)}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Reorder Alerts</div>
                            <div class="kpi-card-number rose">${Number(data.combos_needing_reorder ?? 0).toLocaleString("en-IN")}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Overstocked SKUs</div>
                            <div class="kpi-card-number cyan">${Number(data.combos_overstocked ?? 0).toLocaleString("en-IN")}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Stock Transfer Suggestions</div>
                            <div class="kpi-card-number">${Number(data.stock_transfer_recommendations ?? 0).toLocaleString("en-IN")}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Expected Profit Uplift</div>
                            <div class="kpi-card-number emerald">${formatIndianCurrency(data.total_expected_profit_uplift_next_horizon)}</div>
                        </div>
                        <div class="kpi-card-box">
                            <div class="kpi-card-title">Forecast Accuracy</div>
                            <div class="kpi-card-number cyan">${forecastAccuracy.toFixed(2)}%</div>
                            <div class="kpi-card-detail">WAPE ${(wape * 100).toFixed(2)}%</div>
                        </div>
                    </div>
                `;
            })
            .catch((err) => {
                body.innerHTML = '<div style="color: #ff4757; padding: 20px;">Failed to load executive KPIs.</div>';
            });
    }

    function loadAuditHistory({ render = true } = {}) {
    return Promise.all([
        fetch("/api/action/dispatch-history").then((res) =>
            requireSuccessfulResponse(res, "Audit history")
        ),
        fetch("/api/products")
            .then((res) => requireSuccessfulResponse(res, "Product catalogue"))
            .catch(() => []),
    ]).then(([data, products]) => {
        const productNames = new Map(
            (Array.isArray(products) ? products : []).map((product) => [
                String(product.Product_ID),
                product.Product_Name
            ])
        );

        const enrichProductName = (row) => ({
            ...row,
            product_name:
                row.product_name ||
                productNames.get(String(row.product_id)) ||
                "Product name unavailable",
        });

        const purchaseOrders = Array.isArray(data && data.purchase_orders)
            ? data.purchase_orders.map((row) => ({
                ...enrichProductName(row),
                auditType: "PURCHASE ORDER"
            }))
            : [];

        const stockTransfers = Array.isArray(data && data.stock_transfers)
            ? data.stock_transfers.map((row) => ({
                ...enrichProductName(row),
                auditType: "STOCK TRANSFER"
            }))
            : [];

        const history = [...purchaseOrders, ...stockTransfers]
            .sort((a, b) =>
                String(b.timestamp || "").localeCompare(
                    String(a.timestamp || "")
                )
            );

        currentAuditHistory = history;

        if (render) {
            renderAuditHistory();
        }

        return history;
    });
}
    function openHistoryModal() {
    stopAuditCountdown();

    if (auditRefreshTimer) {
        clearInterval(auditRefreshTimer);
        auditRefreshTimer = null;
    }

    document.querySelector(".nav-modal-content").classList.add("is-wide");
    document.querySelector(".nav-modal-content").classList.add("is-audit-wide");

    document.getElementById("nav-modal-title").textContent =
        "Dispatch & Purchase Order Audit Log";

    const body = document.getElementById("nav-modal-body");

    body.innerHTML =
        '<div style="color: var(--text-muted); font-style: italic; padding: 20px;">Fetching dispatch history...</div>';

    const backdrop = document.getElementById("nav-modal-backdrop");
    backdrop.classList.add("is-open");

    loadAuditHistory()
        .then((history) => {
            if (history.length === 0) {
                body.innerHTML =
                    '<div style="color: #94a3b8; text-align: center; padding: 30px;">No approved dispatches or purchase orders logged yet.</div>';
                return;
            }

            showRemovedAuditRows = false;
            renderAuditHistory();

            auditCountdownTimer = setInterval(
                refreshAuditCountdowns,
                1000
            );

            // Refresh backend transaction list every 5 seconds.
            auditRefreshTimer = setInterval(() => {
    const previousIds = currentAuditHistory
        .map(getAuditRowId)
        .join("|");

    loadAuditHistory({ render: false })
        .then((history) => {
            const newIds = history
                .map(getAuditRowId)
                .join("|");

            if (newIds !== previousIds) {
                renderAuditHistory();
            }
        })
        .catch((error) => {
            console.error("Audit refresh error:", error);
        });
}, 5000);
        })
        .catch((err) => {
            console.error("Audit history error:", err);

            body.innerHTML =
                '<div style="color: #ff4757; padding: 20px;">Failed to load audit history log.</div>';
        });
}

    function parseAuditTimestamp(value) {
        const raw = String(value || "").trim();
        if (!raw) return new Date();

        // Backend timestamps without an explicit timezone are stored in IST.
        // Explicit ISO timezone values are left untouched.
        let normalized = raw.replace(" ", "T");

        if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
            normalized += "+05:30";
        }

        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? new Date() : date;
    }

    function getAuditRowId(row) {
        return String(row.po_number || row.transfer_id || `${row.auditType}-${row.timestamp}-${row.product_id}`);
    }

    function getHiddenAuditIds() {
        try {
            const stored = JSON.parse(localStorage.getItem(hiddenAuditStorageKey) || "[]");
            return new Set(Array.isArray(stored) ? stored.map(String) : []);
        } catch (error) {
            return new Set();
        }
    }

    function saveHiddenAuditIds(ids) {
        try {
            localStorage.setItem(hiddenAuditStorageKey, JSON.stringify([...ids]));
        } catch (error) {
            console.warn("Could not save hidden audit rows:", error);
        }
    }

    function getAuditTiming(row, now = new Date()) {
        const startedAt = parseAuditTimestamp(row.timestamp);
        let completesAt = null;

        // Prefer the exact ETA calculated by the backend.
        if (row.eta_at) {
            const exactEta = new Date(String(row.eta_at));

            if (!Number.isNaN(exactEta.getTime())) {
                completesAt = exactEta;
            }
        }

        // Fallback for older stock-transfer records.
        if (!completesAt && row.auditType === "STOCK TRANSFER") {
            const etaMatch = String(row.eta || "45 minutes")
                .match(/([\d.]+)\s*(minute|hour|day)/i);

            const amount = etaMatch ? Number(etaMatch[1]) : 45;
            const unit = etaMatch ? etaMatch[2].toLowerCase() : "minute";

            const multiplier = unit.startsWith("day")
                ? 86400000
                : unit.startsWith("hour")
                    ? 3600000
                    : 60000;

            completesAt = new Date(
                startedAt.getTime() + amount * multiplier
            );
        }

        // Fallback for older purchase orders.
        else if (!completesAt && row.estimated_delivery) {
            completesAt = new Date(
                `${String(row.estimated_delivery).slice(0, 10)}T18:00:00+05:30`
            );
        }

        // Final fallback.
        else if (!completesAt) {
            completesAt = new Date(
                startedAt.getTime() + 2 * 86400000
            );
        }

        const remainingMs = completesAt.getTime() - now.getTime();

        return {
            startedAt,
            completesAt,
            remainingMs,
            completed: remainingMs <= 0
        };
    }

    function formatCountdown(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (days) return `${days}d ${hours}h ${minutes}m`;
        if (hours) return `${hours}h ${minutes}m ${seconds}s`;
        return `${minutes}m ${seconds}s`;
    }

    function renderAuditHistory() {
        const body = document.getElementById("nav-modal-body");
        if (!body || !currentAuditHistory.length) return;

        const hiddenIds = getHiddenAuditIds();
        const visibleRows = currentAuditHistory.filter((row) => showRemovedAuditRows || !hiddenIds.has(getAuditRowId(row)));
        const hiddenCount = currentAuditHistory.filter((row) => hiddenIds.has(getAuditRowId(row))).length;

        body.innerHTML = `
            <div class="audit-toolbar">
                <div><b>${visibleRows.length}</b> visible transaction${visibleRows.length === 1 ? "" : "s"}</div>
                <div class="audit-toolbar-actions">
                    ${hiddenCount ? `<button class="audit-toolbar-btn" data-audit-action="toggle-removed">${showRemovedAuditRows ? "Hide" : "Show"} removed (${hiddenCount})</button>` : ""}
                    <button class="audit-toolbar-btn audit-download-btn" data-audit-action="download-pdf">Download PDF ↓</button>
                </div>
            </div>
            <div class="audit-table-wrap">
                <table class="supplier-table audit-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Type</th>
                            <th>Details</th>
                            <th>Time remaining</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visibleRows.map((row) => {
                            const timing = getAuditTiming(row);
                            const rowId = getAuditRowId(row);
                            const isRemoved = hiddenIds.has(rowId);
                            const status = timing.completed ? "COMPLETED" : (row.status || "APPROVED");
                            return `
                                <tr class="${timing.completed ? "audit-row-completed" : ""} ${isRemoved ? "audit-row-removed" : ""}">
                                    <td>${escapeHtml(row.timestamp || "Just now")}</td>
                                    <td><b>${escapeHtml(row.auditType)}</b></td>
                                    <td>${formatAuditDetails(row)}</td>
                                    <td>
                                        <div class="audit-countdown ${timing.completed ? "is-complete" : ""}" data-completes-at="${timing.completesAt.getTime()}" data-audit-completed="${timing.completed ? "1" : "0"}">${timing.completed ? "Arrived" : formatCountdown(timing.remainingMs)}</div>
                                        <div class="audit-eta">ETA ${escapeHtml(timing.completesAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</div>
                                    </td>
                                    <td><span class="risk-badge badge-OPTIMAL">${escapeHtml(status)}</span>${timing.completed ? `<div class="audit-stock-note">Stock updated</div><div class="audit-completed-at">Completed ${escapeHtml(timing.completesAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" }))}</div>` : ""}</td>
                                    <td>${timing.completed ? `<button class="audit-remove-btn" data-audit-action="${isRemoved ? "restore" : "remove"}" data-audit-id="${escapeHtml(rowId)}">${isRemoved ? "Restore" : "Remove"}</button>` : ""}</td>
                                </tr>
                            `;
                        }).join("") || '<tr><td colspan="6" class="audit-empty-state">No visible transactions. Use “Show removed” to restore completed entries.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;

        body.onclick = (event) => {
            const button = event.target.closest("[data-audit-action]");
            if (!button) return;
            const action = button.getAttribute("data-audit-action");
            if (action === "toggle-removed") {
                showRemovedAuditRows = !showRemovedAuditRows;
            } else if (action === "download-pdf") {
                downloadAuditPdf();
                return;
            } else {
                const ids = getHiddenAuditIds();
                const rowId = button.getAttribute("data-audit-id");
                if (action === "remove") ids.add(rowId);
                if (action === "restore") ids.delete(rowId);
                saveHiddenAuditIds(ids);
            }
            renderAuditHistory();
        };
    }

    function getAuditDetailsText(row) {
        if (row.auditType === "PURCHASE ORDER") {
            return `${row.po_number || "PO"} | Store ${row.store_id || "-"} | ${row.product_id || "-"} - ${row.product_name || "Product name unavailable"} | ${Number(row.order_qty) || 0} units | ${row.supplier_name || "Supplier"}`;
        }
        return `${row.transfer_id || "Transfer"} | ${row.from_store || "-"} -> ${row.to_store || "-"} | ${row.product_id || "-"} - ${row.product_name || "Product name unavailable"} | ${Number(row.transfer_qty) || 0} units`;
    }

    function normalizePdfText(value) {
        return String(value ?? "")
            .replace(/[–—]/g, "-")
            .replace(/→/g, "->")
            .replace(/₹/g, "INR ")
            .replace(/[^\x20-\x7E]/g, "?");
    }

    function wrapPdfText(value, width = 96) {
        const words = normalizePdfText(value).split(/\s+/);
        const lines = [];
        let line = "";
        words.forEach((word) => {
            if (!word) return;
            if (`${line} ${word}`.trim().length > width && line) {
                lines.push(line);
                line = word;
            } else {
                line = `${line} ${word}`.trim();
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function pdfEscape(value) {
        return normalizePdfText(value).replace(/([\\()])/g, "\\$1");
    }

    function pdfText(value, x, y, size = 8, bold = false, color = "0.12 0.16 0.24") {
        return `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET\n`;
    }

    function pdfRect(x, y, width, height, fill, stroke = null) {
        let command = `${fill} rg ${x} ${y} ${width} ${height} re f\n`;
        if (stroke) command += `${stroke} RG 0.55 w ${x} ${y} ${width} ${height} re S\n`;
        return command;
    }

    function formatPdfDate(date) {
        return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}`;
    }

    function createAuditTablePdf(rows, generatedAt) {
        const columns = [
            { label: "#", width: 26 },
            { label: "Created", width: 96 },
            { label: "Type", width: 72 },
            { label: "Reference", width: 92 },
            { label: "Store movement / Supplier", width: 150 },
            { label: "SKU / Product / Qty", width: 85 },
            { label: "Status", width: 95 },
            { label: "ETA / Completed", width: 155 },
        ];
        const tableX = 35;
        const tableTop = 480;
        const pageBottom = 43;
        const lineHeight = 9;
        const completedCount = rows.filter((row) => getAuditTiming(row, generatedAt).completed).length;
        const transferCount = rows.filter((row) => row.auditType === "STOCK TRANSFER").length;
        const purchaseCount = rows.filter((row) => row.auditType === "PURCHASE ORDER").length;

        const preparedRows = rows.map((row, index) => {
            const timing = getAuditTiming(row, generatedAt);
            const createdParts = String(row.timestamp || "Unknown").split(" ");
            const completionParts = formatPdfDate(timing.completesAt).split(" ");
            const status = timing.completed ? "COMPLETED" : String(row.status || "APPROVED").replaceAll("_", " ");
            const movement = row.auditType === "PURCHASE ORDER"
                ? [`Store ${row.store_id || "-"}`, row.supplier_name || "Supplier"]
                : [`${row.from_store || "-"} -> ${row.to_store || "-"}`, row.city || "Inter-store transfer"];
            const cells = [
                [String(index + 1)],
                [createdParts[0] || "Unknown", createdParts.slice(1).join(" ")],
                wrapPdfText(row.auditType === "PURCHASE ORDER" ? "Purchase order" : "Stock transfer", 16),
                wrapPdfText(row.po_number || row.transfer_id || "-", 20),
                movement.flatMap((value) => wrapPdfText(value, 31)),
                [
                    String(row.product_id || "-"),
                    ...wrapPdfText(row.product_name || "Product name unavailable", 20).slice(0, 2),
                    `${Number(row.order_qty ?? row.transfer_qty) || 0} units`,
                ],
                wrapPdfText(status, 19),
                [timing.completed ? "Completed" : "Expected", completionParts.slice(0, 3).join(" "), completionParts.slice(3).join(" ")],
            ].map((cell) => cell.filter(Boolean).slice(0, 4));
            return { cells, completed: timing.completed, height: Math.max(39, 13 + Math.max(...cells.map((cell) => cell.length)) * lineHeight) };
        });

        const pages = [[]];
        let remainingHeight = tableTop - pageBottom;
        preparedRows.forEach((row) => {
            if (row.height > remainingHeight && pages[pages.length - 1].length) {
                pages.push([]);
                remainingHeight = tableTop - pageBottom;
            }
            pages[pages.length - 1].push(row);
            remainingHeight -= row.height;
        });

        const pageStreams = pages.map((pageRows, pageIndex) => {
            let stream = "1 1 1 rg 0 0 842 595 re f\n";
            stream += pdfRect(0, 530, 842, 65, "0.035 0.065 0.115");
            stream += pdfRect(0, 526, 842, 4, "0.00 0.75 0.86");
            stream += pdfText("RetailBrain AI", 35, 568, 19, true, "1 1 1");
            stream += pdfText("Dispatch and Purchase Order Audit Log", 35, 548, 11, false, "0.72 0.82 0.92");
            stream += pdfText(`Generated ${formatPdfDate(generatedAt)}`, 600, 565, 8, false, "0.72 0.82 0.92");
            stream += pdfText(`Records ${rows.length}   Transfers ${transferCount}   Purchase orders ${purchaseCount}   Completed ${completedCount}`, 35, 510, 8.5, true, "0.12 0.24 0.34");

            let x = tableX;
            columns.forEach((column) => {
                stream += pdfRect(x, tableTop, column.width, 26, "0.055 0.11 0.19", "0.16 0.31 0.42");
                stream += pdfText(column.label, x + 5, tableTop + 9, 7.3, true, "0.86 0.95 0.98");
                x += column.width;
            });

            let rowTop = tableTop;
            pageRows.forEach((row, rowIndex) => {
                const rowBottom = rowTop - row.height;
                const fill = row.completed ? "0.91 0.98 0.95" : ((rowIndex + pageIndex) % 2 ? "0.965 0.975 0.985" : "1 1 1");
                let cellX = tableX;
                columns.forEach((column, columnIndex) => {
                    stream += pdfRect(cellX, rowBottom, column.width, row.height, fill, "0.78 0.84 0.88");
                    const lines = row.cells[columnIndex];
                    lines.forEach((line, lineIndex) => {
                        const isStatus = columnIndex === 6;
                        const color = isStatus && row.completed ? "0.02 0.45 0.30" : "0.12 0.16 0.24";
                        stream += pdfText(line, cellX + 5, rowTop - 13 - lineIndex * lineHeight, 7.2, isStatus || columnIndex === 0, color);
                    });
                    cellX += column.width;
                });
                rowTop = rowBottom;
            });

            stream += pdfText("RetailBrain AI - Internal operational record", 35, 20, 7, false, "0.42 0.49 0.58");
            stream += pdfText(`Page ${pageIndex + 1} of ${pages.length}`, 748, 20, 7, true, "0.42 0.49 0.58");
            return stream;
        });

        const objects = [];
        const normalFontId = 3 + pageStreams.length * 2;
        const boldFontId = normalFontId + 1;
        const pageObjectIds = pageStreams.map((_, index) => 3 + index * 2);
        objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageStreams.length} >>`;
        pageStreams.forEach((stream, index) => {
            const pageId = pageObjectIds[index];
            const contentId = pageId + 1;
            objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${normalFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
            objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
        });
        objects[normalFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
        objects[boldFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

        let pdf = "%PDF-1.4\n%RetailBrain\n";
        const offsets = [0];
        for (let id = 1; id < objects.length; id += 1) {
            offsets[id] = pdf.length;
            pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
        }
        const xrefOffset = pdf.length;
        pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
        for (let id = 1; id < objects.length; id += 1) {
            pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
        return new Blob([pdf], { type: "application/pdf" });
    }

    function downloadAuditPdf() {
        const generatedAt = new Date();
        const blob = createAuditTablePdf(currentAuditHistory, generatedAt);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `RetailBrain-Audit-Log-${generatedAt.toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function refreshAuditCountdowns() {
        const body = document.getElementById("nav-modal-body");
        if (!body || typeof body.querySelectorAll !== "function") return;
        let transactionCompleted = false;

        body.querySelectorAll(".audit-countdown[data-completes-at]").forEach((countdown) => {
            const remainingMs = Number(countdown.getAttribute("data-completes-at")) - Date.now();
            if (remainingMs <= 0) {
                if (countdown.getAttribute("data-audit-completed") !== "1") transactionCompleted = true;
                countdown.textContent = "Arrived";
                countdown.classList.add("is-complete");
                countdown.setAttribute("data-audit-completed", "1");
            } else {
                countdown.textContent = formatCountdown(remainingMs);
            }
        });

        // Rebuild once when an ETA is reached so status and Remove controls appear.
        if (transactionCompleted) renderAuditHistory();
    }

    function formatAuditDetails(row) {
        if (row.auditType === "PURCHASE ORDER") {
            return `${escapeHtml(row.po_number || "PO")} · Store ${escapeHtml(row.store_id || "—")} · ${escapeHtml(row.product_id || "—")} — <b>${escapeHtml(row.product_name || "Product name unavailable")}</b> · ${Number(row.order_qty) || 0} units · ${escapeHtml(row.supplier_name || "Supplier")}`;
        }
        return `${escapeHtml(row.transfer_id || "Transfer")} · ${escapeHtml(row.from_store || "—")} → ${escapeHtml(row.to_store || "—")} · ${escapeHtml(row.product_id || "—")} — <b>${escapeHtml(row.product_name || "Product name unavailable")}</b> · ${Number(row.transfer_qty) || 0} units`;
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
        })[character]);
    }

    function openForecastModal() {
        stopAuditCountdown();
        document.querySelector(".nav-modal-content").classList.add("is-wide");
        document.querySelector(".nav-modal-content").classList.remove("is-audit-wide");
        document.getElementById("nav-modal-title").textContent = "14-Day Demand Forecasting";
        const body = document.getElementById("nav-modal-body");
        body.innerHTML = `
            <div class="forecast-modal-layout">
                <div class="forecast-controls-panel">
                    <label class="forecast-field-label" for="forecast-store-select">Dark Store</label>
                    <select class="form-select" id="forecast-store-select"><option>Loading stores...</option></select>
                    <label class="forecast-field-label" for="forecast-product-select">Product SKU</label>
                    <select class="form-select" id="forecast-product-select"><option>Loading products...</option></select>
                    <button class="btn-confirm-action" id="forecast-render-btn">Plot Demand Curve →</button>
                    <div class="forecast-model-note">Recursive LightGBM forecast · next 14 days</div>
                </div>
                <div class="forecast-visual-panel">
                    <div id="forecast-chart-title" class="forecast-chart-title">Select a store and product</div>
                    <div id="forecast-chart-container" class="forecast-chart-container">
                        <div class="nav-loading-state">Loading forecast controls...</div>
                    </div>
                </div>
            </div>
        `;
        document.getElementById("nav-modal-backdrop").classList.add("is-open");

        Promise.all([
            fetch("/api/stores").then((res) => requireSuccessfulResponse(res, "Store catalog")),
            fetch("/api/products").then((res) => requireSuccessfulResponse(res, "Product catalog")),
        ]).then(([stores, products]) => {
            const storeSelect = document.getElementById("forecast-store-select");
            const productSelect = document.getElementById("forecast-product-select");
            storeSelect.innerHTML = stores.map((store) => `
                <option value="${escapeHtml(store.Store_ID)}">${escapeHtml(store.Store_Name)} · ${escapeHtml(store.City)}</option>
            `).join("");
            productSelect.innerHTML = products.map((product) => `
                <option value="${escapeHtml(product.Product_ID)}">${escapeHtml(product.Product_Name)} · ${escapeHtml(product.Category)}</option>
            `).join("");

            const activeCity = window.RetailBrainMap && window.RetailBrainMap.activeCity;
            if (activeCity) {
                const cityStore = stores.find((store) => store.City === activeCity.name);
                if (cityStore) storeSelect.value = cityStore.Store_ID;
            }
            document.getElementById("forecast-render-btn").onclick = loadForecastCurve;
            loadForecastCurve();
        }).catch((error) => {
            console.error("Forecast controls error:", error);
            document.getElementById("forecast-chart-container").innerHTML = '<div class="nav-error-state">Failed to load stores or products.</div>';
        });
    }

    function loadForecastCurve() {
        const storeSelect = document.getElementById("forecast-store-select");
        const productSelect = document.getElementById("forecast-product-select");
        if (!storeSelect || !productSelect || !storeSelect.value || !productSelect.value) return;

        const chart = document.getElementById("forecast-chart-container");
        chart.innerHTML = '<div class="nav-loading-state">Generating 14-day forecast...</div>';
        fetch(`/api/forecast-chart?store_id=${encodeURIComponent(storeSelect.value)}&product_id=${encodeURIComponent(productSelect.value)}`)
            .then((res) => requireSuccessfulResponse(res, "Forecast"))
            .then((data) => renderForecastCurve(data, storeSelect.options[storeSelect.selectedIndex].text, productSelect.options[productSelect.selectedIndex].text))
            .catch((error) => {
                console.error("Forecast chart error:", error);
                chart.innerHTML = '<div class="nav-error-state">Failed to load forecast data for this selection.</div>';
            });
    }

    function renderForecastCurve(data, storeLabel, productLabel) {
        const values = Array.isArray(data.forecast) ? data.forecast.map(Number).filter(Number.isFinite) : [];
        const dates = Array.isArray(data.dates) ? data.dates : [];
        const chart = document.getElementById("forecast-chart-container");
        if (!values.length || values.length !== dates.length) {
            chart.innerHTML = '<div class="nav-error-state">No forecast points were returned for this selection.</div>';
            return;
        }

        const width = 760, height = 330, left = 48, right = 20, top = 24, bottom = 48;
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = Math.max(maxValue - minValue, 1);
        const points = values.map((value, index) => {
            const x = left + index * ((width - left - right) / Math.max(values.length - 1, 1));
            const y = top + (maxValue - value) * ((height - top - bottom) / range);
            return { x, y, value, date: dates[index] };
        });
        const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
        const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - bottom} L${points[0].x.toFixed(1)},${height - bottom} Z`;
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const peak = points.reduce((best, point) => point.value > best.value ? point : best, points[0]);

        document.getElementById("forecast-chart-title").textContent = `${productLabel} · ${storeLabel}`;
        chart.innerHTML = `
            <div class="forecast-stats-row">
                <div><span>Average/day</span><b>${average.toFixed(1)} units</b></div>
                <div><span>Peak demand</span><b>${peak.value.toFixed(1)} units</b></div>
                <div><span>14-day total</span><b>${values.reduce((sum, value) => sum + value, 0).toFixed(0)} units</b></div>
            </div>
            <svg class="forecast-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="14-day demand forecast">
                <defs><linearGradient id="forecast-area-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#00f2fe" stop-opacity="0.42"/><stop offset="100%" stop-color="#00f2fe" stop-opacity="0.02"/></linearGradient></defs>
                ${[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                    const y = top + fraction * (height - top - bottom);
                    const label = maxValue - fraction * range;
                    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="forecast-grid-line"/><text x="${left - 8}" y="${y + 4}" class="forecast-axis-label" text-anchor="end">${label.toFixed(0)}</text>`;
                }).join("")}
                <path d="${areaPath}" fill="url(#forecast-area-gradient)"/>
                <path d="${linePath}" class="forecast-line"/>
                ${points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4" class="forecast-point"><title>${escapeHtml(point.date)}: ${point.value.toFixed(2)} units</title></circle>${index % 3 === 0 || index === points.length - 1 ? `<text x="${point.x}" y="${height - 20}" class="forecast-axis-label" text-anchor="middle">${escapeHtml(String(point.date).slice(5))}</text>` : ""}`).join("")}
            </svg>
        `;
    }

    function stopAuditCountdown() {
    if (auditCountdownTimer) {
        clearInterval(auditCountdownTimer);
        auditCountdownTimer = null;
    }

    if (auditRefreshTimer) {
        clearInterval(auditRefreshTimer);
        auditRefreshTimer = null;
    }
}

    function hideNavModal() {
        stopAuditCountdown();
        const backdrop = document.getElementById("nav-modal-backdrop");
        if (backdrop) backdrop.classList.remove("is-open");
    }

    window.addEventListener("DOMContentLoaded", initGlobalNav);
    if (document.readyState === "complete" || document.readyState === "interactive") {
        initGlobalNav();
    }
})();
