/**
 * RetailBrain AI — Multilingual welcome cycle
 * Cycles "Welcome" through English + 5 widely-spoken Indian languages,
 * fading between each. Font-family is switched per language so each
 * script renders with proper native typography (not just Latin fallback).
 */
(function () {
    const GREETINGS = [
        { text: "Welcome", lang: "en", font: "var(--font-heading)" },
        { text: "स्वागत है", lang: "hi", font: "var(--font-devanagari)" },
        { text: "स्वागत आहे", lang: "mr", font: "var(--font-devanagari)" },
        { text: "ਜੀ ਆਇਆਂ ਨੂੰ", lang: "pa", font: "var(--font-gurmukhi)" },
        { text: "স্বাগতম", lang: "bn", font: "var(--font-bengali)" },
        { text: "வரவேற்கிறோம்", lang: "ta", font: "var(--font-tamil)" },
    ];

    const CYCLE_MS = 2200;
    const el = document.getElementById("welcome-cycle");
    if (!el) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0;

    function showNext() {
        const g = GREETINGS[i % GREETINGS.length];
        el.style.opacity = "0";

        setTimeout(() => {
            el.textContent = g.text;
            el.lang = g.lang;
            el.style.fontFamily = g.font;
            el.style.opacity = "1";
        }, prefersReducedMotion ? 0 : 300);

        i++;
    }

    showNext();
    if (!prefersReducedMotion) {
        setInterval(showNext, CYCLE_MS);
    }
})();
