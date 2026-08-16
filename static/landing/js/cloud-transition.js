/**
 * RetailBrain AI — Cloud transition (Phase 3)
 *
 * Two cloud banks slide in from the top and bottom edges, meet in the
 * middle to fully cover the screen, then split apart to reveal whatever
 * is underneath. Designed to work ACROSS a page navigation:
 *   - coverAndNavigate(url): plays the "converge" half, then redirects
 *   - revealOnLoad(): call on the destination page's load, starts fully
 *     covered and plays the "part" half to reveal that page
 *
 * Phase 4 (India map page) will call revealOnLoad() on arrival.
 */
window.CloudTransition = (function () {
    const COVER_MS = 900;
    const PART_MS = 900;

    function ensureBuilt() {
        let overlay = document.getElementById("cloud-overlay");
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = "cloud-overlay";

        const top = document.createElement("div");
        top.className = "cloud-layer cloud-layer-top";
        const bottom = document.createElement("div");
        bottom.className = "cloud-layer cloud-layer-bottom";

        for (let i = 0; i < 5; i++) {
            top.appendChild(document.createElement("div")).className = "puff";
            bottom.appendChild(document.createElement("div")).className = "puff";
        }

        overlay.appendChild(top);
        overlay.appendChild(bottom);
        document.body.appendChild(overlay);
        return overlay;
    }

    /** Plays the converge animation, then navigates once fully covered. */
    function coverAndNavigate(url, holdMs = 250) {
        const overlay = ensureBuilt();
        void overlay.offsetWidth; // force layout so the transition below actually plays
        overlay.classList.add("is-covered");

        setTimeout(() => {
            window.location.href = url;
        }, COVER_MS + holdMs);
    }

    /** Starts fully covered (no visible flash), then splits apart to reveal the page. */
    function revealOnLoad(delayMs = 200) {
        const overlay = ensureBuilt();
        const layers = overlay.querySelectorAll(".cloud-layer");

        // Snap instantly to the covered position — no animation on this step
        layers.forEach((l) => (l.style.transition = "none"));
        overlay.classList.add("is-covered");
        void overlay.offsetWidth;
        layers.forEach((l) => (l.style.transition = "")); // restore CSS-defined transition

        setTimeout(() => {
            overlay.classList.add("is-parting");
            setTimeout(() => overlay.remove(), PART_MS + 200);
        }, delayMs);
    }

    return { coverAndNavigate, revealOnLoad };
})();
