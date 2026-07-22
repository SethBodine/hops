// ---- Security helpers ----
// Centralising this in one file makes it easy to audit: every place user-controlled
// data reaches the DOM or gets merged into state should go through these functions.

const Security = {
  // Escape before ANY interpolation into innerHTML. This is the single most important
  // function in the app for preventing stored/reflected XSS via recipe names, notes,
  // ingredient names, imported BeerXML/JSON/URL-share content, etc.
  escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"'`=\/]/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      "`": "&#96;", "=": "&#61;", "/": "&#47;",
    }[c]));
  },

  // Strip dangerous keys before merging any externally-sourced object (imported JSON,
  // URL-share payload, BeerXML-derived object) into app state, to prevent prototype pollution.
  DANGEROUS_KEYS: new Set(["__proto__", "constructor", "prototype"]),
  sanitizeDeep(value, depth = 0) {
    if (depth > 12) return null; // guard against pathological/adversarial nesting
    if (Array.isArray(value)) return value.map(v => this.sanitizeDeep(v, depth + 1));
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) {
        if (this.DANGEROUS_KEYS.has(key)) continue;
        out[key] = this.sanitizeDeep(value[key], depth + 1);
      }
      return out;
    }
    if (typeof value === "string") return value.slice(0, 20000); // cap absurd string sizes
    return value;
  },

  // Parse JSON defensively: size cap + sanitize in one step. Use for every externally
  // sourced payload (file import, URL share, paste).
  safeParseJSON(text, maxBytes = 2_000_000) {
    if (typeof text !== "string" || text.length > maxBytes) {
      throw new Error("Payload too large or invalid");
    }
    const parsed = JSON.parse(text);
    return this.sanitizeDeep(parsed);
  },

  // Basic shape check that an object looks like a recipe before it's trusted enough to render/store.
  looksLikeRecipe(obj) {
    return obj && typeof obj === "object" && typeof obj.name === "string" && Array.isArray(obj.fermentables) && Array.isArray(obj.hops);
  },

  // Clamp a numeric field to sane bounds (defence in depth against absurd values causing
  // rendering issues or being used to construct oversized strings elsewhere).
  clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  },
};
