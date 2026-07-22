// ---- Import adapters ----
// Each entry: { label, extensions: [...], parse(text) -> array of recipe objects }
// Recipes returned by parse() should match the shape produced by newRecipe() in app.js
// (self-contained fermentables/hops/yeast - no external DB lookups required).
//
// To add support for another tool once you have sample exports (Brewfather JSON, etc.):
//   1. Write a `parse(text)` function that returns an array of recipe objects.
//   2. Add an entry below.
//   3. Wire a menu item in the sidebar import control in app.js (search for "IMPORT_ADAPTERS").
// Not all adapters need to be exposed in the UI immediately - this registry exists so the
// plumbing is ready the moment you have something to import.

const IMPORT_ADAPTERS = {
  beerxml: {
    label: "BeerXML (.xml)",
    extensions: [".xml"],
    parse(text) { return BeerXML.parse(text); },
  },
  hopsJson: {
    label: "Hops backup / recipe JSON (.json)",
    extensions: [".json"],
    parse(text) {
      const parsed = Security.safeParseJSON(text);
      if (Array.isArray(parsed)) return parsed.filter(Security.looksLikeRecipe.bind(Security));
      if (parsed && parsed.recipes) return parsed.recipes.filter(Security.looksLikeRecipe.bind(Security));
      if (Security.looksLikeRecipe(parsed)) return [parsed];
      return [];
    },
  },
  // brewfather: { label: "Brewfather Export (.json)", extensions: [".json"], parse(text) { ... } },
  // pybrew:     { label: "pyBrew Project (.json)",     extensions: [".json"], parse(text) { ... } },
};

function pickImportAdapter(filename) {
  const lower = filename.toLowerCase();
  return Object.values(IMPORT_ADAPTERS).find(a => a.extensions.some(ext => lower.endsWith(ext)));
}
