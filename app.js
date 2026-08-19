// ---- Hops app: state, rendering, events ----
const escapeHtml = s => Security.escapeHtml(s);
const STORAGE_KEY = "hops.state.v1";

let state = {
  recipes: [],
  tree: null,
  batches: [],
  equipment: [],
  packaging: [], // packaging/vessel size profiles (kegs, bottles, growlers) - seeded from PACKAGING_PRESETS
  inventory: { fermentables: [], hops: [], yeast: [], misc: [] },
  customIngredients: { fermentables: [], hops: [], yeast: [] },
  unitSystem: "metric", // NZ default. "us" is the alternative.
  region: "New Zealand", // which country's hops/malts/yeast show first in the ingredient pickers
  inventoryRegionFilter: ["New Zealand", "Australia", "Custom"], // regions shown on the Inventory tab; [] = All Regions
  activeSection: "recipes", // recipes | batches | inventory | equipment | tools
  activeId: null,
  activeTab: "design",
  activeBatchId: null,
};

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function nzDate(iso) { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString("en-NZ"); }

// ---- Factories ----
function newRecipe() {
  return {
    id: uid(),
    name: "New Recipe",
    brewer: "",
    type: "All Grain",
    equipmentId: null,
    batchVolGal: 5,
    boilTimeMin: 60,
    efficiencyPct: 70,
    styleName: "American Pale Ale",
    // Manual overrides for the Style Guide Comparison (e.g. a measured OG, or a final
    // fermentable's stated gravity) - null means "use the calculated estimate". Canonical
    // units throughout (SG for og/fg, IBU, SRM, % for abv), same as the calculated values.
    styleOverride: { og: null, fg: null, ibu: null, srm: null, abv: null },
    fermentables: [{ name: "Maris Otter (Crisp)", type: "Grain", amountLb: 10, ppg: 37, color: 4, mashable: true, cost: 0 }],
    hops: [{ name: "Cascade", amountOz: 1, alphaPct: 6.0, timeMin: 60, use: "Boil", whirlpoolTempF: 194, cost: 0 }],
    yeast: { name: "American Ale (Wyeast #1056)", type: "Ale", attenuation: 0.75, cost: 0 },
    misc: [],
    mashWaterVolGal: 4.5,
    spargeWaterVolGal: 3,
    waterBaseName: "Custom",
    waterBase: { Ca: 50, Mg: 5, Na: 10, SO4: 30, Cl: 30, HCO3: 50 },
    waterSalts: [],
    waterTarget: "Balanced Pale Ale",
    mashAcid: { type: ACID_TYPES[0], amountMl: 0 },
    spargeAcid: { type: ACID_TYPES[0], amountMl: 0 },
    mashProfileName: "Single Infusion, Full Body",
    mashSteps: JSON.parse(JSON.stringify(MASH_PROFILES["Single Infusion, Full Body"])),
    grainTempF: 68,
    adjustTempForEquip: false,
    carbProfileName: "American Ale",
    carbLevelVols: 2.4,
    fermentationProfileName: "Standard Ale",
    fermentationProfile: FERMENTATION_PROFILES["Standard Ale"],
    preBoilVolGal: null, // null = auto-estimate from equipment/boil time
    notes: "",
  };
}
function newEquipment(preset) {
  const p = preset || EQUIPMENT_PRESETS[0];
  return { id: uid(), name: p.name, batchVolGal: p.batchVolGal, boilTimeMin: p.boilTimeMin, boilOffRateGalHr: p.boilOffRateGalHr, trubLossGal: p.trubLossGal, mashEfficiencyPct: p.mashEfficiencyPct, tempAdjustF: p.tempAdjustF != null ? p.tempAdjustF : 2 };
}
function newPackaging(preset) {
  const p = preset || PACKAGING_PRESETS[0];
  return { id: uid(), name: p.name, volGal: p.volGal };
}
function newBatch(recipeId) {
  const r = state.recipes.find(x => x.id === recipeId);
  return {
    id: uid(), recipeId, recipeName: r ? r.name : "Unknown Recipe", status: "Planning", brewDate: new Date().toISOString().slice(0, 10), brewStartTime: null, brewEndTime: null, measuredOG: null, measuredFG: null, notes: "",
    // Measured brew-day stats (canonical units: gal, SG, F - same convention as recipes)
    measuredPreBoilGravity: null, measuredPreBoilVolGal: null,
    measuredBatchSizeGal: null, // "into fermenter" - used for measured brewhouse efficiency
    measuredBottlingVolGal: null,
    carbMethod: "Keg", carbTargetVols: null, carbTempF: null, // null carbTargetVols/TempF = fall back to the recipe's own carbonation card
    fermentationReadings: [], // [{ id, date, time, tempF, gravity, notes }] - date is an ISO date string, sorted by date+time on render
    inventoryDeducted: false, // set true once "Deduct from Inventory" has been used for this batch
    suggestionDismissed: null, // status name the user last dismissed the "move to X?" banner for
  };
}
// A batch's name is always its linked recipe's *current* name - it's not an independent
// identity, so it should never go stale when the recipe is renamed elsewhere. `recipeName`
// on the batch object is kept only as a last-known fallback for the (rare) case the linked
// recipe has since been deleted, and is refreshed opportunistically whenever we do have the
// live recipe, so that fallback itself doesn't go stale over time either.
function batchDisplayName(b) {
  const r = state.recipes.find(x => x.id === b.recipeId);
  if (r) { if (b.recipeName !== r.name) b.recipeName = r.name; return r.name; }
  return (b.recipeName || "Unknown Recipe") + " (recipe deleted)";
}
// Backfill fields for batches saved before the measured-stats/fermentation-log feature existed.
function migrateBatch(b) {
  if (b.measuredPreBoilGravity === undefined) b.measuredPreBoilGravity = null;
  if (b.measuredPreBoilVolGal === undefined) b.measuredPreBoilVolGal = null;
  if (b.measuredBatchSizeGal === undefined) b.measuredBatchSizeGal = null;
  if (b.measuredBottlingVolGal === undefined) b.measuredBottlingVolGal = null;
  if (b.carbMethod === undefined) b.carbMethod = "Keg";
  if (b.carbTargetVols === undefined) b.carbTargetVols = null;
  if (b.carbTempF === undefined) b.carbTempF = null;
  if (!Array.isArray(b.fermentationReadings)) b.fermentationReadings = [];
  b.fermentationReadings.forEach(fr => { if (fr.time === undefined) fr.time = null; });
  if (b.brewStartTime === undefined) b.brewStartTime = null;
  if (b.brewEndTime === undefined) b.brewEndTime = null;
  if (b.inventoryDeducted === undefined) b.inventoryDeducted = false;
  if (b.suggestionDismissed === undefined) b.suggestionDismissed = null;
  return b;
}
// Adds every catalogue entry for `kind` matching `region` (or every entry, if region === "__all__")
// into the inventory list, skipping names already present. Returns how many were added.
function addRegionToInventory(kind, region) {
  const catalogue = { fermentables: FERMENTABLES, hops: HOPS, yeast: YEASTS, misc: MISC }[kind];
  if (!catalogue) return 0;
  const existing = new Set(state.inventory[kind].map(i => i.name.toLowerCase()));
  let added = 0;
  catalogue.forEach(item => {
    if (region !== "__all__" && (item.origin || "Custom") !== region) return;
    if (existing.has(item.name.toLowerCase())) return;
    const row = Object.assign(newInventoryItem(kind), JSON.parse(JSON.stringify(item)));
    state.inventory[kind].push(row);
    existing.add(item.name.toLowerCase());
    added++;
  });
  return added;
}
// One-time migration: fold the old separate "custom ingredients" library into inventory (an
// ingredient's spec and its stock are the same row now), then seed the inventory with the
// brewer's chosen region so the dropdowns aren't empty on a fresh install.
function migrateInventoryModel() {
  if (state.inventoryModelV2) return;
  ["fermentables", "hops", "yeast"].forEach(kind => {
    const byName = new Map();
    (state.inventory[kind] || []).forEach(i => byName.set(i.name.toLowerCase(), Object.assign(newInventoryItem(kind), i)));
    ((state.customIngredients || {})[kind] || []).forEach(c => {
      const key = c.name.toLowerCase();
      byName.set(key, Object.assign(byName.get(key) || newInventoryItem(kind), c));
    });
    state.inventory[kind] = Array.from(byName.values());
  });
  if (!state.catalogueSeeded) {
    addRegionToInventory("fermentables", state.region);
    addRegionToInventory("hops", state.region);
    addRegionToInventory("yeast", state.region);
    addRegionToInventory("misc", "__all__"); // not region-specific, so seed the whole small catalogue
    state.catalogueSeeded = true;
  }
  if (!state.miscCatalogueSeeded) {
    // Separate one-time flag: the Misc/Fining catalogue didn't exist when catalogueSeeded was
    // first introduced, so existing saves already have catalogueSeeded=true and would otherwise
    // never get misc items backfilled.
    addRegionToInventory("misc", "__all__");
    state.miscCatalogueSeeded = true;
  }
  if (!state.packagingSeeded) {
    // Same idea as miscCatalogueSeeded above - Packaging didn't exist yet for existing saves.
    if (!state.packaging.length) state.packaging = PACKAGING_PRESETS.map(p => newPackaging(p));
    state.packagingSeeded = true;
  }
  delete state.customIngredients;
  state.inventoryModelV2 = true;
}
// Bugfix (separate from the migration above, which may have already run for people on the
// previous release): items with no real origin used to be stored with origin "" and had
// nowhere to go once a region filter existed, so they silently vanished from view. Backfill
// them to the "Custom" pseudo-region and make sure "Custom" is in anyone's already-saved
// filter, so nothing that used to be visible stays hidden.
function fixCustomRegionVisibility() {
  if (state.customRegionFixV1) return;
  ["fermentables", "hops", "yeast"].forEach(kind => {
    (state.inventory[kind] || []).forEach(item => { if (!item.origin) item.origin = "Custom"; });
  });
  if (Array.isArray(state.inventoryRegionFilter) && state.inventoryRegionFilter.length && !state.inventoryRegionFilter.includes("Custom")) {
    state.inventoryRegionFilter.push("Custom");
  }
  state.customRegionFixV1 = true;
}
function newInventoryItem(kind) {
  const stockDefaults = { fermentables: "kg", hops: "g", yeast: "pkg", misc: "g" };
  const base = { id: uid(), name: "", stock: 0, unit: stockDefaults[kind] || "unit", cost: 0, origin: "Custom" };
  if (kind === "fermentables") return Object.assign(base, { type: "Grain", ppg: 37, srm: 4, mashable: true });
  if (kind === "hops") return Object.assign(base, { alpha: 8 });
  if (kind === "yeast") return Object.assign(base, { type: "Ale", attenuation: 0.75 });
  return base;
}

// ---- Persistence ----
function saveToStorage() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = Security.safeParseJSON(raw, 20000000);
    if (parsed && parsed.recipes && parsed.recipes.length) { Object.assign(state, parsed); return true; }
  } catch (e) { console.error("Failed to load saved data", e); }
  return false;
}

function nodeDisplayName(node) {
  if (node.type === "folder") return node.name;
  const r = state.recipes.find(x => x.id === node.recipeId);
  return r ? r.name : null;
}
function uniqueSiblingName(parentNode, type, desiredName, excludeId) {
  return Tree.uniqueSiblingName(parentNode, type, desiredName, nodeDisplayName, excludeId);
}

function activeRecipe() { return state.recipes.find(r => r.id === state.activeId); }
function activeBatch() { return state.batches.find(b => b.id === state.activeBatchId); }
function styleRef(name) { return STYLES.find(s => s.name === name); }
function equipmentRef(id) { return state.equipment.find(e => e.id === id); }

// ---- Migration: backfill fields for recipes saved under earlier schema versions ----
function migrateRecipe(r) {
  delete r.yeastName; delete r.yeastAttenuation; delete r.yeastCost; delete r.targetFg;
  if (r.waterVolGal != null && r.mashWaterVolGal == null) {
    r.mashWaterVolGal = r.waterVolGal;
    r.spargeWaterVolGal = 0;
    delete r.waterVolGal;
  }
  if (r.mashWaterVolGal == null) r.mashWaterVolGal = 4.5;
  if (r.spargeWaterVolGal == null) r.spargeWaterVolGal = 3;
  if (!r.mashAcid) r.mashAcid = { type: ACID_TYPES[0], amountMl: 0 };
  if (!r.spargeAcid) r.spargeAcid = { type: ACID_TYPES[0], amountMl: 0 };
  if (r.grainTempF == null) r.grainTempF = 68;
  if (r.adjustTempForEquip == null) r.adjustTempForEquip = false;
  if (!r.carbProfileName) r.carbProfileName = "Custom";
  if (!r.fermentationProfileName) r.fermentationProfileName = "Custom";
  if (r.preBoilVolGal === undefined) r.preBoilVolGal = null;
  if (!r.styleOverride) r.styleOverride = { og: null, fg: null, ibu: null, srm: null, abv: null };
  (r.waterSalts || []).forEach(s => { if (!s.use) s.use = "Mash"; });
  (r.hops || []).forEach(h => { if (h.whirlpoolTempF == null) h.whirlpoolTempF = 194; if (h.dryHopDay === undefined) h.dryHopDay = null; if (h.dryHopDurationDays === undefined) h.dryHopDurationDays = null; });
  return r;
}

// ---- Undo Last (single-level, per recipe - mirrors BeerSmith's "Undo Last") ----
let undoSnapshot = null;
function snapshotUndo(r) { undoSnapshot = { recipeId: r.id, data: JSON.parse(JSON.stringify(r)) }; }
function undoLast() {
  if (!undoSnapshot) { toast("Nothing to undo"); return; }
  const idx = state.recipes.findIndex(x => x.id === undoSnapshot.recipeId);
  if (idx === -1) { toast("Nothing to undo"); return; }
  state.recipes[idx] = undoSnapshot.data;
  if (state.activeId === undoSnapshot.recipeId) { /* stay on same recipe */ }
  undoSnapshot = null;
  saveToStorage(); renderAll();
  toast("Undone");
}

// ---- Derived stats (self-contained ingredients, no external DB lookups needed) ----
function computeDerived(r) {
  const ferms = r.fermentables.map(f => ({ amountLb: Number(f.amountLb) || 0, ppg: Number(f.ppg) || 0, srm: Number(f.color) || 0, mashable: f.mashable !== false }));
  const og = Calc.estimateOG(ferms, Number(r.batchVolGal) || 1, Number(r.efficiencyPct) || 70);
  const fg = Calc.estimateFG(og, Number(r.yeast.attenuation) || 0.75);
  const abv = Calc.estimateABV(og, fg);
  const hopsForCalc = r.hops.map(h => ({ amountOz: Number(h.amountOz) || 0, alphaPct: Number(h.alphaPct) || 0, timeMin: Number(h.timeMin) || 0, use: h.use, whirlpoolTempF: h.whirlpoolTempF != null ? Number(h.whirlpoolTempF) : 194 }));
  const ibuBreakdown = Calc.ibuBreakdown(hopsForCalc, Number(r.batchVolGal) || 1, og);
  const ibu = ibuBreakdown.reduce((sum, v) => sum + v, 0);
  const srm = Calc.estimateSRM(ferms, Number(r.batchVolGal) || 1);
  const cost = Calc.totalCost([...r.fermentables, ...r.hops, r.yeast, ...r.misc]);
  const grainPercents = Calc.grainPercent(ferms);

  const equip = equipmentRef(r.equipmentId);
  const preBoilVolGal = r.preBoilVolGal || (Number(r.batchVolGal) || 0) + (equip ? equip.trubLossGal + (equip.boilOffRateGalHr * (r.boilTimeMin || 60) / 60) : (r.boilTimeMin || 60) / 60);
  const preBoilGravity = Calc.estimatePreBoilGravity(ferms, preBoilVolGal, Number(r.efficiencyPct) || 70);
  const totalFermentableLb = ferms.reduce((sum, f) => sum + f.amountLb, 0);
  const poundsPerBarrel = Calc.poundsPerBarrel(totalFermentableLb, Number(r.batchVolGal) || 1);

  // Water: mash and sparge salts are tracked separately; mash chemistry (RA, hardness,
  // alkalinity, SO4:Cl) is calculated from the mash water only, since that's what affects
  // mash pH - sparge water is shown separately for reference.
  const mashSalts = r.waterSalts.filter(s => s.use !== "Sparge").map(s => ({ name: s.name, grams: Number(s.grams) || 0 }));
  const spargeSalts = r.waterSalts.filter(s => s.use === "Sparge").map(s => ({ name: s.name, grams: Number(s.grams) || 0 }));
  const mashAdded = Calc.saltAdditions(mashSalts, Number(r.mashWaterVolGal) || 1);
  const spargeAdded = Calc.saltAdditions(spargeSalts, Number(r.spargeWaterVolGal) || 1);
  const finalWater = Calc.addProfiles(r.waterBase, mashAdded);
  const finalSpargeWater = Calc.addProfiles(r.waterBase, spargeAdded);
  const ra = Calc.residualAlkalinity(finalWater);
  const soCl = Calc.sulfateChlorideRatio(finalWater);
  const hardness = Calc.effectiveHardness(finalWater);
  const alkalinity = Calc.alkalinityAsCaCO3(finalWater);

  // Strike water temperature: ratio of mash water (quarts) to mashable grain weight (lb).
  const mashableGrainLb = ferms.filter(f => f.mashable).reduce((sum, f) => sum + f.amountLb, 0);
  const ratioQtPerLb = mashableGrainLb ? (Number(r.mashWaterVolGal) || 0) * 4 / mashableGrainLb : 0;
  const targetMashTempF = (r.mashSteps[0] && r.mashSteps[0].temp) || 152;
  const equipAdjust = r.adjustTempForEquip && equip ? equip.tempAdjustF : 0;
  const strikeTempF = Calc.strikeWaterTemp(Number(r.grainTempF) || 68, targetMashTempF, ratioQtPerLb, equipAdjust);

  return {
    og, fg, abv, ibu, ibuBreakdown, srm, cost, grainPercents,
    preBoilVolGal, preBoilGravity, poundsPerBarrel,
    finalWater, finalSpargeWater, ra, soCl, hardness, alkalinity,
    ratioQtPerLb, strikeTempF,
  };
}

// ---- Toast & modal ----
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
function showModal(innerHtml, onMount, extraClass) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modalOverlay";
  overlay.innerHTML = '<div class="modal-box' + (extraClass ? " " + extraClass : "") + '">' + innerHtml + '</div>';
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  if (onMount) onMount(overlay);
}
function closeModal() { const el = document.getElementById("modalOverlay"); if (el) el.remove(); }

// ---- Confirm / prompt dialogs ----
// Replacements for window.confirm()/window.prompt(), which render as native browser chrome
// (a different look per browser, with the page URL in the title bar) and stick out next to
// the app's own styled modals. These render through the same showModal()/.modal-box system
// as everything else, so every in-app dialog looks and behaves consistently. Both return a
// Promise so call sites can `await` them like the native versions.
function showConfirmModal(title, bodyHtml, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (settled) return; settled = true; resolve(v); };
    const confirmClass = opts.danger ? "btn btn-danger" : "btn btn-primary";
    const html = '<h3>' + escapeHtml(title) + '</h3>' +
      '<div class="modal-body-text">' + bodyHtml + '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn" id="modalCancelBtn">' + escapeHtml(opts.cancelLabel || "Cancel") + '</button>' +
      '<button class="' + confirmClass + '" id="modalConfirmBtn">' + escapeHtml(opts.confirmLabel || "OK") + '</button>' +
      '</div>';
    showModal(html, overlay => {
      overlay.querySelector("#modalCancelBtn").addEventListener("click", () => { closeModal(); finish(false); });
      overlay.querySelector("#modalConfirmBtn").addEventListener("click", () => { closeModal(); finish(true); });
      overlay.addEventListener("click", e => { if (e.target === overlay) finish(false); });
    });
  });
}
function showPromptModal(title, label, initialValue, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (settled) return; settled = true; resolve(v); };
    const fieldHtml = opts.multiline
      ? '<textarea class="notes-area" id="modalPromptInput" placeholder="' + escapeHtml(opts.placeholder || "") + '">' + escapeHtml(initialValue || "") + '</textarea>'
      : '<input type="text" id="modalPromptInput" value="' + escapeHtml(initialValue || "") + '" placeholder="' + escapeHtml(opts.placeholder || "") + '" maxlength="200"/>';
    const html = '<h3>' + escapeHtml(title) + '</h3>' +
      (opts.description ? '<p class="modal-body-text">' + escapeHtml(opts.description) + '</p>' : "") +
      '<div class="field"><label>' + escapeHtml(label) + '</label>' + fieldHtml + '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn" id="modalCancelBtn">Cancel</button>' +
      '<button class="btn btn-primary" id="modalConfirmBtn">' + escapeHtml(opts.confirmLabel || "Save") + '</button>' +
      '</div>';
    showModal(html, overlay => {
      const input = overlay.querySelector("#modalPromptInput");
      input.focus();
      if (input.select) input.select();
      const submit = () => { const val = input.value; closeModal(); finish(val); };
      const cancel = () => { closeModal(); finish(null); };
      overlay.querySelector("#modalCancelBtn").addEventListener("click", cancel);
      overlay.querySelector("#modalConfirmBtn").addEventListener("click", submit);
      if (!opts.multiline) input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      overlay.addEventListener("click", e => { if (e.target === overlay) finish(null); });
    });
  });
}

// ---- Context menu ----
function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "ctxMenu";
  menu.innerHTML = items.map((it, i) => it.divider ? '<div class="ctx-divider"></div>' : '<div class="ctx-item ' + (it.danger ? "danger" : "") + '" data-i="' + i + '">' + escapeHtml(it.label) + '</div>').join("");
  document.body.appendChild(menu);
  const w = window.innerWidth, h = window.innerHeight;
  menu.style.left = Math.min(x, w - 200) + "px";
  menu.style.top = Math.min(y, h - menu.offsetHeight - 10) + "px";
  menu.querySelectorAll(".ctx-item").forEach(el => el.addEventListener("click", () => { items[Number(el.dataset.i)].action(); closeContextMenu(); }));
  setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 0);
}
function closeContextMenu() { const el = document.getElementById("ctxMenu"); if (el) el.remove(); }

// ---- Export / Import ----
function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function downloadJSON(data, filename) { downloadFile(JSON.stringify(data, null, 2), filename, "application/json"); }

function exportAll() { downloadJSON(state, "hops-backup-" + Date.now() + ".json"); toast("Exported full backup"); }
function exportOneRecipe(r) { downloadJSON({ recipes: [r] }, r.name.replace(/\s+/g, "_") + ".json"); toast("Exported " + r.name); }
function exportBeerXML(r) { downloadFile(BeerXML.generate(r), r.name.replace(/\s+/g, "_") + ".xml", "application/xml"); toast("Exported " + r.name + " as BeerXML"); }

function importFile(file) {
  const isXml = /\.xml$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (isXml) {
        const recipes = BeerXML.parse(reader.result).map(migrateRecipe);
        if (!recipes.length) { toast("No valid recipes found in file"); return; }
        promptImportRecipes(recipes, "BeerXML");
        return;
      }
      const parsed = Security.safeParseJSON(reader.result, 20000000);
      const isFullBackup = parsed && Array.isArray(parsed.recipes) && (parsed.equipment || parsed.batches || parsed.inventory || parsed.tree || parsed.customIngredients);
      if (isFullBackup) { promptImportBackup(parsed); return; }
      const recipes = IMPORT_ADAPTERS.hopsJson.parse(reader.result).map(migrateRecipe);
      if (!recipes.length) { toast("No valid recipes found in file"); return; }
      promptImportRecipes(recipes, "JSON");
    } catch (e) {
      toast("Could not read that file: " + e.message);
      console.error(e);
    }
  };
  reader.readAsText(file);
}
function addLeafToRoot(recipeId) { state.tree.children.push(Tree.createLeaf(recipeId)); }

// ---- Import: always ask whether to add new copies or overwrite matching recipes ----
function promptImportRecipes(recipes, sourceLabel) {
  const matches = recipes.map(rec => {
    const byId = state.recipes.find(x => x.id === rec.id);
    const byName = state.recipes.find(x => x.name.toLowerCase() === rec.name.toLowerCase());
    return { rec, existing: byId || byName || null };
  });
  const matchCount = matches.filter(m => m.existing).length;
  showModal(
    '<h3>Import ' + recipes.length + " Recipe" + (recipes.length > 1 ? "s" : "") + '</h3>' +
    '<p style="font-size:var(--fs-base);color:var(--ink-dim);">via ' + escapeHtml(sourceLabel) + '. ' +
    (matchCount ? matchCount + " match" + (matchCount > 1 ? "" : "es") + " a recipe you already have; " : "") +
    (recipes.length - matchCount) + " new.</p>" +
    '<ul style="font-size:var(--fs-sm);color:var(--ink-faint);max-height:160px;overflow-y:auto;margin:10px 0;padding-left:18px;">' +
    matches.map(m => "<li>" + escapeHtml(m.rec.name) + (m.existing ? ' <span style="color:var(--amber);">(matches your "' + escapeHtml(m.existing.name) + '")</span>' : "") + "</li>").join("") +
    "</ul>" +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">' +
    '<button class="btn btn-primary" id="importAppendBtn">Add All as New (never overwrites)</button>' +
    (matchCount ? '<button class="btn" id="importOverwriteBtn">Overwrite Matches, Add Rest as New</button>' : "") +
    '<button class="btn btn-ghost" id="importCancelBtn">Cancel</button>' +
    "</div>",
    overlay => {
      overlay.querySelector("#importAppendBtn").addEventListener("click", () => {
        matches.forEach(m => {
          const copy = JSON.parse(JSON.stringify(m.rec));
          copy.id = uid();
          copy.name = uniqueSiblingName(state.tree, "recipe", copy.name);
          state.recipes.push(copy); addLeafToRoot(copy.id);
        });
        finishImport(matches.length, 0);
      });
      const overwriteBtn = overlay.querySelector("#importOverwriteBtn");
      if (overwriteBtn) overwriteBtn.addEventListener("click", () => {
        let added = 0, overwritten = 0;
        matches.forEach(m => {
          if (m.existing) {
            const idx = state.recipes.findIndex(x => x.id === m.existing.id);
            const updated = JSON.parse(JSON.stringify(m.rec));
            updated.id = m.existing.id; // keep the existing id so the tree entry & any batches still point at it
            state.recipes[idx] = updated;
            overwritten++;
          } else {
            const copy = JSON.parse(JSON.stringify(m.rec));
            copy.id = uid();
            copy.name = uniqueSiblingName(state.tree, "recipe", copy.name);
            state.recipes.push(copy); addLeafToRoot(copy.id);
            added++;
          }
        });
        finishImport(added, overwritten);
      });
      overlay.querySelector("#importCancelBtn").addEventListener("click", closeModal);
    }
  );
}
function finishImport(added, overwritten) {
  state.activeSection = "recipes";
  if (state.recipes.length) state.activeId = state.recipes[state.recipes.length - 1].id;
  saveToStorage(); closeModal(); renderAll();
  const parts = [];
  if (added) parts.push(added + " added");
  if (overwritten) parts.push(overwritten + " overwritten");
  toast(parts.length ? parts.join(", ") : "Import cancelled");
}

// ---- Full backup import: merge recipes only, or replace everything ----
function promptImportBackup(parsed) {
  const rCount = (parsed.recipes || []).length;
  const bCount = (parsed.batches || []).length;
  const eCount = (parsed.equipment || []).length;
  showModal(
    "<h3>Full Hops Backup Detected</h3>" +
    '<p style="font-size:var(--fs-base);color:var(--ink-dim);">' + rCount + " recipe(s), " + bCount + " batch(es), " + eCount + " equipment profile(s).</p>" +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">' +
    '<button class="btn" id="mergeRecipesBtn">Merge Recipes Only (keep my current batches/inventory/equipment)</button>' +
    '<button class="btn btn-danger" id="replaceAllBtn">Replace Everything on This Device</button>' +
    '<button class="btn btn-ghost" id="backupCancelBtn">Cancel</button>' +
    "</div>",
    overlay => {
      overlay.querySelector("#mergeRecipesBtn").addEventListener("click", () => {
        closeModal();
        const recipes = (parsed.recipes || []).map(migrateRecipe);
        if (!recipes.length) { toast("No recipes found in backup"); return; }
        promptImportRecipes(recipes, "backup file");
      });
      overlay.querySelector("#replaceAllBtn").addEventListener("click", async () => {
        const ok = await showConfirmModal(
          "Replace Everything?",
          "This replaces every recipe, batch, folder, inventory item, and equipment profile currently stored in this browser with the contents of the backup file. This can't be undone.",
          { confirmLabel: "Replace Everything", danger: true }
        );
        if (!ok) return;
        const restored = Security.sanitizeDeep(parsed);
        (restored.recipes || []).forEach(migrateRecipe);
        (restored.batches || []).forEach(migrateBatch);
        if (!restored.tree) { restored.tree = Tree.createRoot(); (restored.recipes || []).forEach(r => restored.tree.children.push(Tree.createLeaf(r.id))); }
        Tree.pruneOrphans(restored.tree, new Set((restored.recipes || []).map(r => r.id)));
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, restored, { activeSection: "recipes", activeId: (restored.recipes && restored.recipes[0]) ? restored.recipes[0].id : null, activeTab: "design", activeBatchId: null });
        if (!state.equipment) state.equipment = [];
        if (!state.packaging) state.packaging = PACKAGING_PRESETS.map(p => newPackaging(p));
        if (!state.inventory) state.inventory = { fermentables: [], hops: [], yeast: [], misc: [] };
        if (!state.customIngredients) state.customIngredients = { fermentables: [], hops: [], yeast: [] };
        if (!state.unitSystem) state.unitSystem = "metric";
        if (!state.region) state.region = "New Zealand";
        if (!Array.isArray(state.inventoryRegionFilter)) state.inventoryRegionFilter = ["New Zealand", "Australia", "Custom"];
        migrateInventoryModel();
        fixCustomRegionVisibility();
        saveToStorage(); closeModal(); renderAll();
        toast("Backup restored");
      });
      overlay.querySelector("#backupCancelBtn").addEventListener("click", closeModal);
    }
  );
}

// ---- Scale recipe ----
async function scaleRecipe(r) {
  const label = Units.unitLabel("volume-gal", state.unitSystem);
  const currentDisplay = Units.toDisplay(r.batchVolGal, "volume-gal", state.unitSystem).toFixed(2);
  const input = await showPromptModal("Scale Recipe", "New batch size (" + label + ")", currentDisplay, { description: 'Scale "' + r.name + '" to a new batch size. All fermentables and hops are scaled proportionally.', confirmLabel: "Scale" });
  if (input === null) return;
  const newDisplay = Number(input);
  if (!newDisplay || newDisplay <= 0) { toast("Enter a valid batch size"); return; }
  snapshotUndo(r);
  const newVolGal = Units.toCanonical(newDisplay, "volume-gal", state.unitSystem);
  const ratio = newVolGal / r.batchVolGal;
  r.fermentables.forEach(f => f.amountLb = +(f.amountLb * ratio).toFixed(3));
  r.hops.forEach(h => h.amountOz = +(h.amountOz * ratio).toFixed(3));
  r.misc.forEach(m => m.amount = +(m.amount * ratio).toFixed(3));
  r.mashWaterVolGal = +(r.mashWaterVolGal * ratio).toFixed(2);
  r.spargeWaterVolGal = +(r.spargeWaterVolGal * ratio).toFixed(2);
  r.batchVolGal = +newVolGal.toFixed(2);
  saveToStorage(); renderAll();
  toast("Scaled to " + newDisplay + " " + label);
}

// ---- Update Prices: price each recipe line from matching inventory stock ----
function updatePricesFromInventory(r) {
  snapshotUndo(r);
  let updated = 0;
  r.fermentables.forEach(f => {
    const item = state.inventory.fermentables.find(i => i.name.toLowerCase() === f.name.toLowerCase());
    if (item) { f.cost = +(Units.lbToUnit(f.amountLb, item.unit) * item.cost).toFixed(2); updated++; }
  });
  r.hops.forEach(h => {
    const item = state.inventory.hops.find(i => i.name.toLowerCase() === h.name.toLowerCase());
    if (item) { h.cost = +(Units.lbToUnit(h.amountOz / 16, item.unit) * item.cost).toFixed(2); updated++; }
  });
  const yeastItem = state.inventory.yeast.find(i => i.name.toLowerCase() === r.yeast.name.toLowerCase());
  if (yeastItem) { r.yeast.cost = +yeastItem.cost.toFixed(2); updated++; }
  r.misc.forEach(m => {
    const item = state.inventory.misc.find(i => i.name.toLowerCase() === m.name.toLowerCase());
    if (item && item.unit === m.unit) { m.cost = +(m.amount * item.cost).toFixed(2); updated++; }
  });
  saveToStorage(); renderMain();
  toast(updated ? "Updated pricing on " + updated + " line(s) from inventory" : "No matching inventory items found");
}

// ---- Sharing ----
function shareModalHtml(title, description, fullUrl) {
  return '<h3>' + title + '</h3>' +
    '<p class="hint-text">' + description + '</p>' +
    '<input class="share-link-input" id="shareLinkInput" readonly value="' + escapeHtml(fullUrl) + '"/>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
    '<button class="btn btn-primary" id="copyLinkBtn" style="flex:1;">Copy Link</button>' +
    '<button class="btn" id="shortenLinkBtn" style="flex:1;">Shorten via b0x.nz</button>' +
    '</div>' +
    '<div style="margin-top:14px;text-align:right;"><button class="btn btn-sm" id="closeModalBtn">Close</button></div>';
}
function wireShareModal(overlay, fullUrl) {
  overlay.querySelector("#copyLinkBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(overlay.querySelector("#shareLinkInput").value).then(() => toast("Link copied"));
  });
  overlay.querySelector("#shortenLinkBtn").addEventListener("click", async e => {
    e.target.textContent = "Shortening\u2026"; e.target.disabled = true;
    const short = await LinkShortener.shorten(fullUrl);
    if (short) { overlay.querySelector("#shareLinkInput").value = short; toast("Link shortened"); }
    else toast("Shortening failed \u2014 using full link instead");
    e.target.textContent = "Shorten via b0x.nz"; e.target.disabled = false;
  });
  overlay.querySelector("#closeModalBtn").addEventListener("click", closeModal);
}

async function shareRecipe(r) {
  try {
    const encoded = await Share.encodeRecipe(r);
    const fullUrl = Share.buildShareUrl(encoded);
    showModal(shareModalHtml('Share "' + escapeHtml(r.name) + '"', "This link contains the whole recipe. Anyone who opens it can view it and choose to add it to their own Hops.", fullUrl), overlay => wireShareModal(overlay, fullUrl));
  } catch (e) {
    toast("Could not create share link: " + e.message);
  }
}

async function shareBatch(b) {
  try {
    const recipe = state.recipes.find(x => x.id === b.recipeId) || null;
    const encoded = await Share.encodeBatch(b, recipe);
    const fullUrl = Share.buildShareUrl(encoded);
    showModal(shareModalHtml('Share Batch: "' + escapeHtml(batchDisplayName(b)) + '"',
      "This link contains the batch (status, readings, notes) and its recipe, so it opens with full context on any device \u2014 handy for building the brew day on a computer, then capturing notes and timings on a phone. Send the link back the same way to report changes.",
      fullUrl), overlay => wireShareModal(overlay, fullUrl));
  } catch (e) {
    toast("Could not create share link: " + e.message);
  }
}

async function checkIncomingShare() {
  const encoded = Share.readFromLocation();
  if (!encoded) return;
  try {
    const { kind, data } = await Share.decode(encoded);
    if (kind === "recipe") handleIncomingRecipeShare(migrateRecipe(data));
    else if (kind === "batch") handleIncomingBatchShare(data);
  } catch (e) {
    toast("Shared link could not be read: " + e.message);
    Share.clearFromLocation();
  }
}

function handleIncomingRecipeShare(incoming) {
  const existing = state.recipes.find(x => x.id === incoming.id);
  const d = (() => { try { return computeDerived(incoming); } catch (e2) { return null; } })();
  showModal(
    '<h3>Shared Recipe</h3>' +
    '<p><strong>' + escapeHtml(incoming.name) + '</strong>' + (incoming.brewer ? " by " + escapeHtml(incoming.brewer) : "") + '</p>' +
    (d ? '<p class="hint-text">OG ' + d.og.toFixed(3) + ' \u00b7 ' + d.abv.toFixed(1) + '% ABV \u00b7 ' + Math.round(d.ibu) + ' IBU</p>' : "") +
    (existing ? '<p style="color:var(--amber);font-size:var(--fs-base);">You already have a recipe with this ID: "' + escapeHtml(existing.name) + '".</p>' : "") +
    '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
    '<button class="btn btn-primary" id="addNewBtn" style="flex:1;">Add as New Recipe</button>' +
    (existing ? '<button class="btn" id="updateExistingBtn" style="flex:1;">Update Existing</button>' : "") +
    '<button class="btn btn-ghost" id="dismissShareBtn" style="flex:1;">Dismiss</button>' +
    '</div>',
    overlay => {
      overlay.querySelector("#addNewBtn").addEventListener("click", () => {
        const copy = JSON.parse(JSON.stringify(incoming));
        copy.id = uid();
        copy.name = uniqueSiblingName(state.tree, "recipe", copy.name);
        state.recipes.push(copy); addLeafToRoot(copy.id);
        state.activeId = copy.id; state.activeSection = "recipes";
        saveToStorage(); Share.clearFromLocation(); closeModal(); renderAll();
        toast("Recipe added");
      });
      const updateBtn = overlay.querySelector("#updateExistingBtn");
      if (updateBtn) updateBtn.addEventListener("click", () => {
        const idx = state.recipes.findIndex(x => x.id === incoming.id);
        state.recipes[idx] = incoming;
        state.activeId = incoming.id; state.activeSection = "recipes";
        saveToStorage(); Share.clearFromLocation(); closeModal(); renderAll();
        toast("Recipe updated");
      });
      overlay.querySelector("#dismissShareBtn").addEventListener("click", () => { Share.clearFromLocation(); closeModal(); });
    }
  );
}

function handleIncomingBatchShare(data) {
  const incomingBatch = migrateBatch(data.batch);
  const incomingRecipe = data.recipe ? migrateRecipe(data.recipe) : null;
  const existingBatch = state.batches.find(x => x.id === incomingBatch.id);
  const haveRecipe = state.recipes.some(x => x.id === incomingBatch.recipeId);
  showModal(
    '<h3>Shared Batch</h3>' +
    '<p><strong>' + escapeHtml(incomingBatch.recipeName) + '</strong> \u2014 ' + escapeHtml(incomingBatch.status) + ' \u00b7 ' + nzDate(incomingBatch.brewDate) + '</p>' +
    (incomingBatch.notes ? '<p class="hint-text">"' + escapeHtml(incomingBatch.notes.slice(0, 140)) + (incomingBatch.notes.length > 140 ? "\u2026" : "") + '"</p>' : "") +
    (!haveRecipe && incomingRecipe ? '<p class="hint-text">Its recipe ("' + escapeHtml(incomingRecipe.name) + '") will be added too, since you don\u2019t have it yet.</p>' : "") +
    (existingBatch ? '<p style="color:var(--amber);font-size:var(--fs-base);">You already have a batch with this ID.</p>' : "") +
    '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
    '<button class="btn btn-primary" id="addNewBatchBtn" style="flex:1;">Add as New Batch</button>' +
    (existingBatch ? '<button class="btn" id="updateExistingBatchBtn" style="flex:1;">Update Existing Batch</button>' : "") +
    '<button class="btn btn-ghost" id="dismissShareBtn" style="flex:1;">Dismiss</button>' +
    '</div>',
    overlay => {
      function ensureRecipePresent() {
        if (!haveRecipe && incomingRecipe) {
          const copy = JSON.parse(JSON.stringify(incomingRecipe));
          copy.name = uniqueSiblingName(state.tree, "recipe", copy.name);
          state.recipes.push(copy); addLeafToRoot(copy.id);
        }
      }
      overlay.querySelector("#addNewBatchBtn").addEventListener("click", () => {
        ensureRecipePresent();
        const copy = JSON.parse(JSON.stringify(incomingBatch));
        copy.id = uid();
        state.batches.push(copy);
        state.activeBatchId = copy.id; state.activeSection = "batches";
        saveToStorage(); Share.clearFromLocation(); closeModal(); renderAll();
        toast("Batch added");
      });
      const updateBtn = overlay.querySelector("#updateExistingBatchBtn");
      if (updateBtn) updateBtn.addEventListener("click", () => {
        ensureRecipePresent();
        const idx = state.batches.findIndex(x => x.id === incomingBatch.id);
        state.batches[idx] = incomingBatch;
        state.activeBatchId = incomingBatch.id; state.activeSection = "batches";
        saveToStorage(); Share.clearFromLocation(); closeModal(); renderAll();
        toast("Batch updated");
      });
      overlay.querySelector("#dismissShareBtn").addEventListener("click", () => { Share.clearFromLocation(); closeModal(); });
    }
  );
}

// ================= RENDERING: TOP LEVEL =================
function renderAll() { renderSidebar(); renderMain(); }
const SECTIONS = [
  { key: "recipes", label: "Recipes" }, { key: "batches", label: "Batches" },
  { key: "inventory", label: "Inventory" }, { key: "equipment", label: "Equipment" }, { key: "tools", label: "Tools" },
];

function renderSidebar() {
  const nav = document.getElementById("sectionNav");
  nav.innerHTML = SECTIONS.map(s => '<div class="section-tab ' + (state.activeSection === s.key ? "active" : "") + '" data-section="' + s.key + '">' + s.label + '</div>').join("");
  nav.querySelectorAll(".section-tab").forEach(el => el.addEventListener("click", () => { state.activeSection = el.dataset.section; saveToStorage(); renderAll(); }));

  const list = document.getElementById("recipeList");
  const newBtn = document.getElementById("newRecipeBtn");
  const newFolderBtn = document.getElementById("newFolderBtn");

  if (state.activeSection === "recipes") {
    newBtn.style.display = "block"; newBtn.textContent = "+ New Recipe";
    newFolderBtn.style.display = "block";
    list.innerHTML = '<div class="tree-root" data-node-id="' + state.tree.id + '"></div>';
    renderTreeNode(state.tree, list.querySelector(".tree-root"), 0);
  } else if (state.activeSection === "batches") {
    newBtn.style.display = state.recipes.length ? "block" : "none"; newBtn.textContent = "+ New Batch";
    newFolderBtn.style.display = "none";
    list.innerHTML = state.batches.length ? state.batches.map(b =>
      '<div class="recipe-item ' + (b.id === state.activeBatchId ? "active" : "") + '" data-id="' + b.id + '">' +
      '<div class="item-eyebrow">Batch</div>' +
      '<div class="name">' + escapeHtml(batchDisplayName(b)) + '</div>' +
      '<div class="meta">' + escapeHtml(b.status) + ' \u00b7 ' + nzDate(b.brewDate) + '</div></div>'
    ).join("") : '<div class="empty-row" style="padding:24px 10px;">No batches yet</div>';
    list.querySelectorAll(".recipe-item").forEach(el => el.addEventListener("click", () => { state.activeBatchId = el.dataset.id; saveToStorage(); renderAll(); }));
  } else {
    newBtn.style.display = "none"; newFolderBtn.style.display = "none"; list.innerHTML = "";
  }
}

// ---- Tree rendering (recipes/folders) with drag-drop + context menu ----
function renderTreeNode(node, container, depth) {
  node.children.forEach(child => {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = (10 + depth * 22) + "px";
    row.dataset.nodeId = child.id;
    row.dataset.nodeType = child.type;
    row.dataset.depth = depth;
    row.draggable = true;

    if (child.type === "folder") {
      const count = Tree.countRecipes(child);
      row.classList.add("tree-folder");
      row.innerHTML = '<span class="tree-caret">' + (child.expanded ? "\u25be" : "\u25b8") + '</span><span class="tree-icon">\ud83d\udcc1</span><span class="tree-label">' + escapeHtml(child.name) + '</span><span class="tree-count">' + count + '</span>';
      row.addEventListener("click", e => { e.stopPropagation(); child.expanded = !child.expanded; saveToStorage(); renderSidebar(); });
    } else {
      const r = state.recipes.find(x => x.id === child.recipeId);
      row.classList.add("tree-recipe");
      if (r && r.id === state.activeId && state.activeSection === "recipes") row.classList.add("active");
      if (!r) {
        row.innerHTML = '<span class="tree-icon">\u26a0\ufe0f</span><span class="tree-label" style="color:var(--alert);">Missing recipe</span>';
      } else {
        const d = computeDerived(r);
        row.innerHTML = '<span class="tree-icon">\ud83c\udf7a</span><div><div class="tree-label">' + escapeHtml(r.name) + '</div><div class="tree-meta">OG ' + d.og.toFixed(3) + ' \u00b7 ' + d.abv.toFixed(1) + '% \u00b7 ' + Math.round(d.ibu) + ' IBU</div></div>';
        row.addEventListener("click", () => { state.activeId = r.id; state.activeSection = "recipes"; state.activeTab = "design"; saveToStorage(); renderAll(); });
      }
    }

    row.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); openTreeContextMenu(e, child, node); });
    row.addEventListener("dragstart", e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", child.id); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    if (child.type === "folder") {
      row.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); row.classList.add("drag-over"); });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", e => {
        e.preventDefault(); e.stopPropagation(); row.classList.remove("drag-over");
        const draggedId = e.dataTransfer.getData("text/plain");
        if (Tree.moveNode(state.tree, draggedId, child.id)) { saveToStorage(); renderSidebar(); toast("Moved"); }
      });
    }

    container.appendChild(row);
    if (child.type === "folder" && child.expanded) renderTreeNode(child, container, depth + 1);
  });

  if (depth === 0) {
    container.addEventListener("dragover", e => { if (e.target === container) e.preventDefault(); });
    container.addEventListener("drop", e => {
      if (e.target !== container) return;
      const draggedId = e.dataTransfer.getData("text/plain");
      if (Tree.moveNode(state.tree, draggedId, state.tree.id)) { saveToStorage(); renderSidebar(); toast("Moved to top level"); }
    });
  }
}

function openTreeContextMenu(e, node, parent) {
  const items = [];
  if (node.type === "folder") {
    items.push({ label: "New Recipe Here", action: () => {
      const r = newRecipe();
      r.name = uniqueSiblingName(node, "recipe", r.name);
      state.recipes.push(r); node.children.push(Tree.createLeaf(r.id));
      state.activeId = r.id; state.activeTab = "design"; saveToStorage(); renderAll();
    }});
    items.push({ label: "New Folder Here", action: () => {
      node.children.push(Tree.createFolder(uniqueSiblingName(node, "folder", "New Folder")));
      saveToStorage(); renderSidebar();
    }});
    items.push({ label: "Rename Folder", action: async () => {
      const name = await showPromptModal("Rename Folder", "Folder name", node.name);
      if (name) {
        const parentNode = Tree.findParent(state.tree, node.id) || state.tree;
        Tree.renameNode(state.tree, node.id, uniqueSiblingName(parentNode, "folder", name, node.id));
        saveToStorage(); renderSidebar();
      }
    }});
    items.push({ label: "Edit Notes", action: async () => {
      const notes = await showPromptModal("Folder Notes", "Notes", node.notes || "", { multiline: true });
      if (notes !== null) { node.notes = notes; saveToStorage(); }
    }});
    if (node.id !== "root") {
      items.push({ divider: true });
      items.push({ label: "Delete Folder & Contents", danger: true, action: async () => {
        const count = Tree.countRecipes(node);
        const ok = await showConfirmModal("Delete Folder?", 'Delete "' + escapeHtml(node.name) + '"' + (count ? " and its " + count + " recipe(s)" : "") + "? This can't be undone.", { confirmLabel: "Delete", danger: true });
        if (!ok) return;
        const recipeIds = new Set();
        (function collect(n) { if (n.type === "recipe") recipeIds.add(n.recipeId); else n.children.forEach(collect); })(node);
        state.recipes = state.recipes.filter(r => !recipeIds.has(r.id));
        Tree.removeNode(state.tree, node.id);
        if (recipeIds.has(state.activeId)) state.activeId = (state.recipes[0] && state.recipes[0].id) || null;
        saveToStorage(); renderAll();
      }});
    }
  } else {
    const r = state.recipes.find(x => x.id === node.recipeId);
    if (r) {
      items.push({ label: "Open", action: () => { state.activeId = r.id; state.activeSection = "recipes"; saveToStorage(); renderAll(); } });
      items.push({ label: "Clone", action: () => {
        const copy = JSON.parse(JSON.stringify(r)); copy.id = uid();
        const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
        const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
        copy.name = uniqueSiblingName(parentNode, "recipe", r.name + " (copy)");
        state.recipes.push(copy);
        parentNode.children.push(Tree.createLeaf(copy.id));
        state.activeId = copy.id; saveToStorage(); renderAll(); toast("Recipe cloned");
      }});
      items.push({ label: "Rename", action: async () => {
        const name = await showPromptModal("Rename Recipe", "Recipe name", r.name);
        if (name) {
          const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
          const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
          r.name = uniqueSiblingName(parentNode, "recipe", name, leaf ? leaf.id : undefined);
          saveToStorage(); renderAll();
        }
      }});
      items.push({ label: "Share Link", action: () => shareRecipe(r) });
      items.push({ divider: true });
      items.push({ label: "Delete", danger: true, action: async () => {
        const ok = await showConfirmModal("Delete Recipe?", 'Delete "' + escapeHtml(r.name) + '"? This can\'t be undone.', { confirmLabel: "Delete", danger: true });
        if (!ok) return;
        state.recipes = state.recipes.filter(x => x.id !== r.id);
        Tree.removeNode(state.tree, node.id);
        if (state.activeId === r.id) state.activeId = (state.recipes[0] && state.recipes[0].id) || null;
        saveToStorage(); renderAll();
      }});
    }
  }
  showContextMenu(e.clientX, e.clientY, items);
}

function renderMain() {
  const main = document.getElementById("main");
  if (state.activeSection === "recipes") return renderRecipesMain(main);
  if (state.activeSection === "batches") return renderBatchesMain(main);
  if (state.activeSection === "inventory") return renderInventoryMain(main);
  if (state.activeSection === "equipment") return renderEquipmentMain(main);
  if (state.activeSection === "tools") return renderToolsMain(main);
}

// ================= RECIPES =================
function renderRecipesMain(main) {
  const r = activeRecipe();
  if (!r) {
    main.innerHTML = '<div class="empty-state"><h2>No recipe selected</h2><p>Create a new recipe, or import a BeerXML / JSON file to get started.</p><button class="btn btn-primary" id="emptyNewBtn">+ New Recipe</button></div>';
    document.getElementById("emptyNewBtn").addEventListener("click", handleNewRecipe);
    return;
  }
  const d = computeDerived(r);
  const style = styleRef(r.styleName);
  main.innerHTML =
    '<div class="recipe-header"><input class="recipe-title-input" id="recipeName" value="' + escapeHtml(r.name) + '" />' +
    '<div class="header-actions">' +
    '<button class="btn btn-sm" id="runChecksBtn">Run Checks</button>' +
    '<button class="btn btn-sm" id="shareBtn">Share</button>' +
    '<button class="btn btn-sm" id="scaleBtn">Scale</button>' +
    '<button class="btn btn-sm" id="updatePricesBtn">Update Prices</button>' +
    '<button class="btn btn-sm" id="undoLastBtn">Undo Last</button>' +
    '<button class="btn btn-sm" id="dupBtn">Duplicate</button>' +
    '<button class="btn btn-sm" id="exportXmlBtn">Export BeerXML</button>' +
    '<button class="btn btn-sm" id="exportOneBtn">Export JSON</button>' +
    '<button class="btn btn-sm btn-danger" id="deleteBtn">Delete</button>' +
    '</div></div>' +
    renderGaugeStrip(d, style) +
    renderSanityBanner(d, r) +
    '<div class="tabs">' + tabBtn("design", "Design") + tabBtn("water", "Water") + tabBtn("mash", "Mash & Ferment") + tabBtn("history", "Brew History") + tabBtn("notes", "Notes") + '</div>' +
    '<div id="tabPanel"></div>';
  document.getElementById("recipeName").addEventListener("input", e => { r.name = e.target.value; saveToStorage(); renderSidebar(); });
  document.getElementById("recipeName").addEventListener("blur", e => {
    if (!e.target.value.trim()) { e.target.value = r.name = "Untitled Recipe"; }
    const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
    const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
    const deduped = uniqueSiblingName(parentNode, "recipe", r.name, leaf ? leaf.id : undefined);
    if (deduped !== r.name) { r.name = deduped; e.target.value = deduped; toast('Renamed to "' + deduped + '" to avoid a duplicate name'); }
    saveToStorage(); renderSidebar();
  });
  document.getElementById("runChecksBtn").addEventListener("click", () => runRecipeChecks(r, d, style));
  document.getElementById("shareBtn").addEventListener("click", () => shareRecipe(r));
  document.getElementById("scaleBtn").addEventListener("click", () => scaleRecipe(r));
  document.getElementById("updatePricesBtn").addEventListener("click", () => updatePricesFromInventory(r));
  document.getElementById("undoLastBtn").addEventListener("click", () => undoLast());
  document.getElementById("dupBtn").addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(r)); copy.id = uid();
    const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
    const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
    copy.name = uniqueSiblingName(parentNode, "recipe", r.name + " (copy)");
    state.recipes.push(copy);
    parentNode.children.push(Tree.createLeaf(copy.id));
    state.activeId = copy.id; saveToStorage(); renderAll();
  });
  document.getElementById("exportXmlBtn").addEventListener("click", () => exportBeerXML(r));
  document.getElementById("exportOneBtn").addEventListener("click", () => exportOneRecipe(r));
  document.getElementById("deleteBtn").addEventListener("click", async () => {
    const ok = await showConfirmModal("Delete Recipe?", 'Delete "' + escapeHtml(r.name) + '"? This can\'t be undone.', { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
    if (leaf) Tree.removeNode(state.tree, leaf.id);
    state.recipes = state.recipes.filter(x => x.id !== r.id);
    state.activeId = state.recipes.length ? state.recipes[0].id : null;
    saveToStorage(); renderAll();
  });
  main.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { state.activeTab = t.dataset.tab; renderMain(); }));
  renderTabPanel(r, d, style);
}

function tabBtn(key, label) { return '<div class="tab ' + (state.activeTab === key ? "active" : "") + '" data-tab="' + key + '">' + label + '</div>'; }

function renderGaugeStrip(d, style) {
  const gauges = [
    gaugeHtml("Original Gravity", d.og.toFixed(3), "", d.og, style && style.og),
    gaugeHtml("Final Gravity", d.fg.toFixed(3), "", d.fg, style && style.fg),
    gaugeHtml("ABV", d.abv.toFixed(1), "%", d.abv, style && style.abv),
    gaugeHtml("Bitterness", Math.round(d.ibu), "IBU", d.ibu, style && style.ibu),
    colorGaugeHtml(d.srm, style && style.srm),
  ];
  return '<div class="gauge-strip">' + gauges.join("") + '</div>';
}
function gaugeHtml(label, display, unit, value, range) {
  const inRange = range ? Calc.inRange(value, range) : null;
  const pct = range ? Math.max(0, Math.min(100, ((value - range[0]) / (range[1] - range[0])) * 100)) : null;
  return '<div class="gauge ' + (inRange === false ? "out" : "") + '"><div class="label">' + label + '</div><div class="value">' + display + '<span class="unit">' + unit + '</span></div>' +
    (range ? '<div class="range-track"><div class="range-marker" style="left:' + pct + '%"></div></div><div class="range-label">' + range[0] + '\u2013' + range[1] + ' style range</div>' : '<div class="range-label">no style selected</div>') + '</div>';
}
// srm is always the canonical (SRM) value; range (if given) is also in canonical SRM - both are
// converted to the active display unit (SRM or EBC) here, at the point of showing them.
function colorGaugeHtml(srm, range) {
  const inRange = range ? Calc.inRange(srm, range) : null;
  const unit = uLabel("color-srm");
  const dispVal = uVal(srm, "color-srm");
  const dispRange = range ? range.map(v => uVal(v, "color-srm")) : null;
  return '<div class="gauge ' + (inRange === false ? "out" : "") + '"><div class="label">Colour</div><div class="value" style="align-items:center;"><div class="color-swatch" style="background:' + Calc.srmToRgb(srm) + '"></div><span style="margin-left:8px;">' + dispVal.toFixed(1) + '<span class="unit">' + unit + '</span></span></div>' +
    (dispRange ? '<div class="range-label" style="margin-top:10px;">' + dispRange[0].toFixed(1) + '\u2013' + dispRange[1].toFixed(1) + ' ' + unit + ' style range</div>' : "") + '</div>';
}

function renderSanityBanner(d, r) {
  const warnings = Calc.sanityWarnings(d, r);
  if (!warnings.length) return "";
  return '<div class="sanity-banner" title="' + escapeHtml(warnings.join(" \u2014 ")) + '">' +
    '<span class="sanity-icon">\u26a0\ufe0f</span>' +
    '<div><div class="sanity-headline">Hey, this doesn\u2019t look right \u2014 you may want to check your values</div>' +
    '<ul class="sanity-list">' + warnings.map(w => "<li>" + escapeHtml(w) + "</li>").join("") + '</ul></div>' +
    '</div>';
}

// "Run Checks" (BeerSmith 4's on-demand recipe-readiness button): opens a report modal rather
// than a passive banner, since it's a deliberate "am I ready to brew this" action, not something
// that should interrupt every render the way the sanity banner does.
function runRecipeChecks(r, d, style) {
  const checks = Calc.recipeChecks(d, r, style);
  const icon = { error: "\u26d4", warning: "\u26a0\ufe0f", info: "\u2139\ufe0f" };
  const bySeverity = { error: [], warning: [], info: [] };
  checks.forEach(c => bySeverity[c.severity].push(c.message));
  const section = (severity, label) => bySeverity[severity].length
    ? '<div class="check-group check-' + severity + '"><h4>' + icon[severity] + ' ' + label + ' (' + bySeverity[severity].length + ')</h4><ul>' +
      bySeverity[severity].map(m => '<li>' + escapeHtml(m) + '</li>').join("") + '</ul></div>'
    : "";
  const html = '<h3>Run Checks: \u201c' + escapeHtml(r.name) + '\u201d</h3>' +
    (checks.length === 0
      ? '<p style="color:var(--ink-dim);">\u2705 No issues found \u2014 this recipe looks ready to brew.</p>'
      : '<p class="hint-text">' + checks.length + ' item' + (checks.length > 1 ? "s" : "") + ' worth a look before brew day:</p>' +
        section("error", "Needs fixing") + section("warning", "Worth checking") + section("info", "For your information")) +
    '<div style="margin-top:14px;"><button class="btn btn-primary" id="closeChecksBtn" style="width:100%;">Close</button></div>';
  showModal(html, overlay => { overlay.querySelector("#closeChecksBtn").addEventListener("click", closeModal); });
}

function renderTabPanel(r, d, style) {
  const panel = document.getElementById("tabPanel");
  if (state.activeTab === "design") panel.innerHTML = designTabHtml(r, style);
  if (state.activeTab === "water") panel.innerHTML = waterTabHtml(r, d);
  if (state.activeTab === "mash") panel.innerHTML = mashTabHtml(r, d);
  if (state.activeTab === "history") panel.innerHTML = historyTabHtml(r);
  if (state.activeTab === "notes") panel.innerHTML = notesTabHtml(r);
  wireTabEvents(r);
}

function uLabel(kind) { return Units.unitLabel(kind, state.unitSystem); }
function uVal(canonical, kind) { return +Units.toDisplay(canonical, kind, state.unitSystem).toFixed(kind === "temp-f" ? 0 : 3); }

// ---- Design tab ----
function designTabHtml(r, style) {
  const d = computeDerived(r);
  const equipOptions = state.equipment.map(e => '<option value="' + e.id + '" ' + (r.equipmentId === e.id ? "selected" : "") + '>' + escapeHtml(e.name) + '</option>').join("");

  const fermRows = r.fermentables.length ? r.fermentables.map((f, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><button type="button" class="btn btn-sm picker-btn" data-open-picker="fermentables" title="Click to choose a different fermentable">' + escapeHtml(f.name) + '</button></td>' +
    '<td><input type="number" step="0.1" data-tbl="fermentables" data-field="amountLb" data-unitkind="weight-lb" value="' + uVal(f.amountLb, "weight-lb") + '"/></td>' +
    '<td><select data-tbl="fermentables" data-field="type">' + ["Grain", "Adjunct", "Sugar", "Extract"].map(t => '<option ' + (f.type === t ? "selected" : "") + '>' + t + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.5" data-tbl="fermentables" data-field="ppg" value="' + f.ppg + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="fermentables" data-field="color" data-unitkind="color-srm" value="' + uVal(f.color, "color-srm") + '"/></td>' +
    '<td class="num grist-pct">' + (d.grainPercents[i] || 0).toFixed(1) + '%</td>' +
    '<td><input type="number" step="0.01" data-tbl="fermentables" data-field="cost" value="' + (f.cost || 0) + '"/></td>' +
    '<td class="row-actions"><button class="btn btn-sm" data-save-item="fermentables">Save</button><button class="del-btn" data-del="fermentables">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="8">No fermentables yet</td></tr>';

  const hopRows = r.hops.length ? r.hops.map((h, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><button type="button" class="btn btn-sm picker-btn" data-open-picker="hops" title="Click to choose a different hop">' + escapeHtml(h.name) + '</button></td>' +
    '<td><input type="number" step="0.1" data-tbl="hops" data-field="amountOz" data-unitkind="weight-oz" value="' + uVal(h.amountOz, "weight-oz") + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="hops" data-field="alphaPct" value="' + h.alphaPct + '"/></td>' +
    '<td><input type="number" step="1" data-tbl="hops" data-field="timeMin" value="' + h.timeMin + '"/></td>' +
    '<td><select data-tbl="hops" data-field="use">' + ["Boil", "Whirlpool", "Dry Hop"].map(u => '<option ' + (h.use === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td>' + (h.use === "Whirlpool" ? '<input type="number" step="1" data-tbl="hops" data-field="whirlpoolTempF" data-unitkind="temp-f" value="' + uVal(h.whirlpoolTempF != null ? h.whirlpoolTempF : 194, "temp-f") + '" title="Whirlpool/stand temperature - the single biggest factor in how much IBU a whirlpool addition contributes"/>' : '<span style="color:var(--ink-faint);">\u2014</span>') + '</td>' +
    '<td>' + (h.use === "Dry Hop" ? '<input type="number" step="1" min="0" data-tbl="hops" data-field="dryHopDay" value="' + (h.dryHopDay != null ? h.dryHopDay : "") + '" placeholder="day #" title="Day into fermentation this addition goes in"/>' : '<span style="color:var(--ink-faint);">\u2014</span>') + '</td>' +
    '<td>' + (h.use === "Dry Hop" ? '<input type="number" step="1" min="0" data-tbl="hops" data-field="dryHopDurationDays" value="' + (h.dryHopDurationDays != null ? h.dryHopDurationDays : "") + '" placeholder="days" title="How many days this addition stays in before packaging/removal"/>' : '<span style="color:var(--ink-faint);">\u2014</span>') + '</td>' +
    '<td class="num hop-ibu">' + (d.ibuBreakdown[i] || 0).toFixed(1) + '</td>' +
    '<td><input type="number" step="0.01" data-tbl="hops" data-field="cost" value="' + (h.cost || 0) + '"/></td>' +
    '<td class="row-actions"><button class="btn btn-sm" data-save-item="hops">Save</button><button class="del-btn" data-del="hops">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="11">No hops yet</td></tr>';

  const miscRows = r.misc.length ? r.misc.map((m, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><button type="button" class="btn btn-sm picker-btn" data-open-picker="misc" title="Click to choose a different item">' + escapeHtml(m.name) + '</button></td>' +
    '<td><input type="number" step="0.1" data-tbl="misc" data-field="amount" value="' + m.amount + '"/></td>' +
    '<td><select data-tbl="misc" data-field="unit">' + ["g", "oz", "tsp", "ml", "tablet", "item"].map(u => '<option ' + (m.unit === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td><select data-tbl="misc" data-field="use">' + ["Mash", "Boil", "Fermentation", "Bottling"].map(u => '<option ' + (m.use === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.01" data-tbl="misc" data-field="cost" value="' + (m.cost || 0) + '"/></td>' +
    '<td><button class="del-btn" data-del="misc">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="6">Nothing added</td></tr>';

  return (
    '<div class="card"><h3>General</h3><div class="field-grid">' +
    '<div class="field"><label>Brewer</label><input data-field="brewer" value="' + escapeHtml(r.brewer) + '"/></div>' +
    '<div class="field"><label>Type</label><select data-field="type">' + ["All Grain", "Extract", "Partial Mash", "BIAB"].map(t => '<option ' + (r.type === t ? "selected" : "") + '>' + t + '</option>').join("") + '</select></div>' +
    '<div class="field"><label>Equipment Profile</label><select data-field="equipmentId"><option value="">\u2014 none \u2014</option>' + equipOptions + '</select></div>' +
    '<div class="field"><label>Batch Size (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-field="batchVolGal" data-unitkind="volume-gal" value="' + uVal(r.batchVolGal, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Boil Time (min)</label><input type="number" step="1" data-field="boilTimeMin" value="' + r.boilTimeMin + '"/></div>' +
    '<div class="field"><label>Mash Efficiency (%)</label><input type="number" step="1" data-field="efficiencyPct" value="' + r.efficiencyPct + '"/></div>' +
    '<div class="field"><label>Style</label><button type="button" class="btn btn-sm picker-btn" data-open-picker="style" style="width:100%;text-align:left;">' + escapeHtml(r.styleName || "\u2014 choose a style \u2014") + '</button></div>' +
    '</div></div>' +
    '<div class="card"><h3>Fermentables <button class="btn btn-sm" data-action="addFermentable">+ Add Fermentable</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:22%">Name</th><th>Amount (' + uLabel("weight-lb") + ')</th><th>Type</th><th>PPG</th><th>Colour (' + uLabel("color-srm") + ')</th><th>% Grist</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + fermRows + '</tbody></table></div>' +
    '<div class="card"><h3>Hops <button class="btn btn-sm" data-action="addHop">+ Add Hop</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:18%">Name</th><th>Amount (' + uLabel("weight-oz") + ')</th><th>Alpha %</th><th>Time (min)</th><th>Use</th><th>Stand Temp (' + uLabel("temp-f") + ')</th><th>Dry Hop Day</th><th>Duration (days)</th><th>IBU</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + hopRows + '</tbody></table></div>' +
    '<div class="card"><h3>Yeast <span><button class="btn btn-sm" data-save-item="yeast">Save Item</button></span></h3><div class="field-grid">' +
    '<div class="field"><label>Strain</label><button type="button" class="btn btn-sm picker-btn" data-open-picker="yeast" style="width:100%;text-align:left;">' + escapeHtml(r.yeast.name || "\u2014 choose a strain \u2014") + '</button></div>' +
    '<div class="field"><label>Attenuation (%)</label><input type="number" step="1" data-field="yeastAttenuation" value="' + (r.yeast.attenuation * 100).toFixed(0) + '"/></div>' +
    '<div class="field"><label>Target Final Gravity' + (style ? ' <button class="btn btn-sm" data-action="matchStyleFg" title="Set to the middle of ' + escapeHtml(style.name) + '\u2019s FG range" style="padding:0 6px;">Match Style</button>' : "") + '</label><input type="number" step="0.001" data-field="targetFg" value="' + d.fg.toFixed(3) + '"/></div>' +
    '<div class="field"><label>Cost ($)</label><input type="number" step="0.01" data-field="yeastCost" value="' + (r.yeast.cost || 0) + '"/></div>' +
    '</div><p class="hint-text" style="margin:6px 0 0;">Final gravity isn\u2019t pulled from the style automatically \u2014 it\u2019s calculated from Original Gravity and yeast Attenuation. Type a number into Target Final Gravity (or hit Match Style, once a style is picked above) and Attenuation is worked out backwards to hit it.</p></div>' +
    '<div class="card"><h3>Misc / Fining Agents <button class="btn btn-sm" data-action="addMisc">+ Add Item</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:34%">Name</th><th>Amount</th><th>Unit</th><th>Use</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + miscRows + '</tbody></table></div>' +
    '<div class="card"><h3>Cost & Batch Stats</h3><div class="field-grid">' +
    '<div class="field"><label>Pre-Boil Volume (' + uLabel("volume-gal") + ', blank = auto)</label><input type="number" step="0.1" data-field="preBoilVolGal" data-unitkind="volume-gal" value="' + (r.preBoilVolGal ? uVal(r.preBoilVolGal, "volume-gal") : "") + '" placeholder="' + uVal(d.preBoilVolGal, "volume-gal").toFixed(2) + '"/></div>' +
    '</div>' +
    '<div class="stat-row"><span class="stat-label">Pre-Boil Gravity</span><span class="stat-value preboil-gravity">' + d.preBoilGravity.toFixed(3) + ' (at ' + uVal(d.preBoilVolGal, "volume-gal").toFixed(2) + ' ' + uLabel("volume-gal") + ')</span></div>' +
    '<div class="stat-row"><span class="stat-label">' + (uLabel("weight-lb") === "kg" ? "Kilograms" : "Pounds") + ' per Barrel</span><span class="stat-value lb-per-barrel">' + uVal(d.poundsPerBarrel, "weight-lb").toFixed(2) + '</span></div>' +
    '<div class="stat-row"><span class="stat-label">Total Recipe Cost</span><span class="stat-value total-cost">$' + d.cost.toFixed(2) + '</span></div>' +
    '</div>' +
    '<div class="card"><h3>Style Guide Comparison</h3>' + (style ? styleCompareHtml(r, style) : '<p class="hint-text">Pick a style above to compare.</p>') + '</div>'
  );
}

// FG = 1 + (OG points) x (1 - attenuation), so attenuation = 1 - (FG points / OG points).
// This is the inverse of Calc.estimateFG - given a target FG, work out the attenuation
// that would produce it at the recipe's current OG, and set that as the yeast's attenuation.
function applyTargetFg(r, targetFg) {
  if (!targetFg || targetFg <= 1) return;
  const d = computeDerived(r);
  const ogPoints = (d.og - 1) * 1000;
  if (ogPoints <= 0) return;
  const fgPoints = (targetFg - 1) * 1000;
  const attenuation = 1 - (fgPoints / ogPoints);
  const clamped = Math.max(0, Math.min(1, attenuation));
  r.yeast.attenuation = clamped;
  if (attenuation > 1) toast("That FG is lower than 100% attenuation can reach from this OG \u2014 capped at 100%");
  else if (attenuation < 0) toast("That FG is above the wort's OG \u2014 capped at 0% attenuation");
}
// Each row: [label, calculated value, style range, formatter, override field name, step, unitkind]
function styleCompareRows(r, d, style) {
  return [
    ["Original Gravity", d.og, style.og, v => v.toFixed(3), "og", "0.001", null],
    ["Final Gravity", d.fg, style.fg, v => v.toFixed(3), "fg", "0.001", null],
    ["ABV", d.abv, style.abv, v => v.toFixed(1) + "%", "abv", "0.1", null],
    ["Bitterness (IBU)", d.ibu, style.ibu, v => Math.round(v), "ibu", "1", null],
    ["Colour (" + uLabel("color-srm") + ")", uVal(d.srm, "color-srm"), style.srm.map(v => uVal(v, "color-srm")), v => v.toFixed(1), "srm", "0.1", "color-srm"],
  ];
}

function styleCompareHtml(r, style) {
  const d = computeDerived(r);
  const ov = r.styleOverride || {};
  return styleCompareRows(r, d, style).map(row => {
    const label = row[0], val = row[1], range = row[2], fmt = row[3], field = row[4], step = row[5], unitkind = row[6];
    const lo = range[0], hi = range[1];
    // Override is stored in canonical units - convert to display units for showing/editing, same as the calculated value.
    const rawOverride = ov[field];
    const overrideVal = rawOverride == null ? null : (unitkind ? uVal(rawOverride, unitkind) : Number(rawOverride));
    const hasOverride = overrideVal != null && !isNaN(overrideVal);
    const spanLo = Math.min(lo, val, hasOverride ? overrideVal : lo) - (hi - lo) * 0.15;
    const spanHi = Math.max(hi, val, hasOverride ? overrideVal : hi) + (hi - lo) * 0.15;
    const pct = v => Math.max(0, Math.min(100, ((v - spanLo) / (spanHi - spanLo)) * 100));
    const inRange = Calc.inRange(val, range);
    const overrideInRange = hasOverride && Calc.inRange(unitkind ? rawOverride : overrideVal, range);
    // Once an override exists it's the "real" reading, so it takes the prominent dot styling;
    // the calculated estimate steps back to a smaller, fainter secondary marker.
    const estClass = "dot " + (hasOverride ? "dot-secondary" : "dot-est") + (inRange ? "" : " out");
    const overrideClass = "dot dot-est" + (overrideInRange ? "" : " out");
    return '<div class="style-compare-row ' + (hasOverride ? (overrideInRange ? "" : "out") : (inRange ? "" : "out")) + '">' +
      '<div class="metric-name">' + label + '</div>' +
      '<div class="track">' +
      '<div class="range-tick" style="left:' + pct(lo) + '%;"><span class="range-tick-label range-tick-lo">' + fmt(lo) + '</span></div>' +
      '<div class="range-tick" style="left:' + pct(hi) + '%;"><span class="range-tick-label range-tick-hi">' + fmt(hi) + '</span></div>' +
      '<div class="band" style="left:' + pct(lo) + '%; width:' + (pct(hi) - pct(lo)) + '%;"></div>' +
      '<div class="' + estClass + '" title="Estimated: ' + fmt(val) + '" style="left:' + pct(val) + '%;"></div>' +
      (hasOverride ? '<div class="' + overrideClass + '" title="Override: ' + fmt(overrideVal) + '" style="left:' + pct(overrideVal) + '%;"></div>' : '') +
      '</div>' +
      '<div class="value-label">' + (hasOverride ? fmt(overrideVal) : fmt(val)) + (hasOverride ? '<span class="range-text">est. ' + fmt(val) + '</span>' : '<span class="range-text">&nbsp;</span>') + '</div>' +
      '<div class="override-cell">' +
      '<input type="number" step="' + step + '" class="override-input" data-field="styleOverride.' + field + '"' + (unitkind ? ' data-unitkind="' + unitkind + '"' : '') +
      ' placeholder="Override" value="' + (hasOverride ? overrideVal : "") + '" title="Manual/measured override - shown alongside the estimate, doesn\u2019t replace it"/>' +
      '<button class="override-clear" data-clear-override="' + field + '" title="Clear override"' + (hasOverride ? "" : ' style="visibility:hidden;"') + '>\u2715</button>' +
      '</div></div>';
  }).join("");
}
// Wires the Style Guide Comparison card's override inputs/clear buttons. Called both at initial
// tab render (wireTabEvents) and every time refreshComputed() replaces the card's innerHTML -
// that replacement creates brand-new DOM nodes with no listeners, so without re-calling this,
// every override after the first stops working (the original bug: only the very first field
// edited ever had a live listener, and even its own "clear" button died the moment any
// override triggered a re-render).
function wireStyleOverrideEvents(container, r) {
  container.querySelectorAll('[data-field^="styleOverride."]').forEach(el => el.addEventListener("change", () => {
    const field = el.dataset.field.split(".")[1];
    let val = el.value === "" ? null : Number(el.value);
    if (val != null && el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
    r.styleOverride[field] = val;
    saveToStorage(); refreshComputed(r);
  }));
  container.querySelectorAll("[data-clear-override]").forEach(btn => btn.addEventListener("click", () => {
    r.styleOverride[btn.dataset.clearOverride] = null;
    saveToStorage(); refreshComputed(r);
  }));
}

// ---- Water tab ----
function waterTabHtml(r, d) {
  const t = r.waterTarget;
  const ionInputs = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"].map(ion =>
    '<div class="ion-box"><div class="ion-name">' + ion + '</div>' +
    '<input type="number" step="1" class="ion-input" data-field="waterBase.' + ion + '" value="' + (r.waterBase[ion] || 0) + '"/></div>'
  ).join("");
  const adjustedIons = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"].map(ion =>
    '<div class="ion-box"><div class="ion-name">' + ion + '</div><div class="ion-value" data-ion-group="mash" data-ion="' + ion + '">' + Math.round(d.finalWater[ion]) + '</div></div>'
  ).join("");
  const adjustedSpargeIons = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"].map(ion =>
    '<div class="ion-box"><div class="ion-name">' + ion + '</div><div class="ion-value" data-ion-group="sparge" data-ion="' + ion + '">' + Math.round(d.finalSpargeWater[ion]) + '</div></div>'
  ).join("");
  const targetOptions = Object.keys(WATER_TARGET_PROFILES).map(k => '<option ' + (t === k ? "selected" : "") + '>' + k + '</option>').join("");
  const saltRows = r.waterSalts.length ? r.waterSalts.map((s, i) =>
    '<tr data-idx="' + i + '"><td><select data-tbl="waterSalts" data-field="name">' + Object.keys(WATER_SALTS).map(name => '<option ' + (s.name === name ? "selected" : "") + '>' + name + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.1" data-tbl="waterSalts" data-field="grams" value="' + s.grams + '"/></td>' +
    '<td><select data-tbl="waterSalts" data-field="use">' + ["Mash", "Sparge"].map(u => '<option ' + ((s.use || "Mash") === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td><button class="del-btn" data-del="waterSalts">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="4">No salt additions</td></tr>';
  const acidTypeOptions = sel => ACID_TYPES.map(a => '<option ' + (sel === a ? "selected" : "") + '>' + a + '</option>').join("");

  return (
    '<div class="card"><h3>Base Water Profile</h3><p class="hint-text" style="margin:-6px 0 10px;">Your source water, before any salts or acid additions \u2014 edit the ion values directly below.</p><div class="field-grid">' +
    '<div class="field"><label>Source Name</label><input data-field="waterBaseName" value="' + escapeHtml(r.waterBaseName) + '"/></div>' +
    '<div class="field"><label>Mash Water (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-field="mashWaterVolGal" data-unitkind="volume-gal" value="' + uVal(r.mashWaterVolGal, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Sparge Water (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-field="spargeWaterVolGal" data-unitkind="volume-gal" value="' + uVal(r.spargeWaterVolGal, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Total Water Needed</label><input disabled value="' + (uVal(r.mashWaterVolGal, "volume-gal") + uVal(r.spargeWaterVolGal, "volume-gal")).toFixed(2) + ' ' + uLabel("volume-gal") + '"/></div>' +
    '</div><div class="ion-grid" style="margin-top:14px;">' + ionInputs + '</div></div>' +
    '<div class="card"><h3>Mash & Sparge Water Agents<span><select id="targetProfileSelect" class="btn btn-sm">' + targetOptions + '</select>' +
    '<button class="btn btn-sm" data-action="addSalt">+ Add Salt</button></span></h3>' +
    '<p class="hint-text" style="margin:-2px 0 10px;">Each salt\u2019s <strong>Use</strong> determines which profile below it affects \u2014 Mash-use salts adjust the Mash profile, Sparge-use salts adjust the Sparge profile.</p>' +
    '<table class="ing-table"><thead><tr><th style="width:36%">Salt</th><th>Amount (g)</th><th>Use</th><th></th></tr></thead><tbody>' + saltRows + '</tbody></table></div>' +
    '<div class="card"><h3>Acid Additions</h3><div class="field-grid">' +
    '<div class="field"><label>Mash Acid</label><select data-field="mashAcid.type">' + acidTypeOptions(r.mashAcid.type) + '</select></div>' +
    '<div class="field"><label>Mash Acid Amount (mL)</label><input type="number" step="0.1" data-field="mashAcid.amountMl" value="' + r.mashAcid.amountMl + '"/></div>' +
    '<div class="field"><label>Sparge Acid</label><select data-field="spargeAcid.type">' + acidTypeOptions(r.spargeAcid.type) + '</select></div>' +
    '<div class="field"><label>Sparge Acid Amount (mL)</label><input type="number" step="0.1" data-field="spargeAcid.amountMl" value="' + r.spargeAcid.amountMl + '"/></div>' +
    '</div><p class="hint-text" style="margin:10px 0 0;">Tracked for reference only \u2014 not currently factored into the residual alkalinity estimate below (proper mash pH prediction needs a grain-acidity model beyond what Hops calculates).</p></div>' +
    '<div class="card"><h3>Adjusted Mash Water Profile <span style="font-weight:400;color:var(--ink-faint);font-size:var(--fs-sm);">(calculated \u2014 base + Mash-use salts)</span></h3><div class="ion-grid">' + adjustedIons + '</div></div>' +
    '<div class="card"><h3>Adjusted Sparge Water Profile <span style="font-weight:400;color:var(--ink-faint);font-size:var(--fs-sm);">(calculated \u2014 base + Sparge-use salts)</span></h3><div class="ion-grid">' + adjustedSpargeIons + '</div></div>' +
    '<div class="card"><h3>Water Analysis (Mash Water)</h3>' +
    '<div class="stat-row"><span class="stat-label">Residual Alkalinity</span><span class="stat-value stat-ra">' + d.ra.toFixed(1) + ' ppm as CaCO3</span></div>' +
    '<div class="stat-row"><span class="stat-label">Alkalinity</span><span class="stat-value stat-alk">' + d.alkalinity.toFixed(1) + ' ppm as CaCO3</span></div>' +
    '<div class="stat-row"><span class="stat-label">Effective Hardness</span><span class="stat-value stat-hardness">' + d.hardness.toFixed(1) + ' ppm as CaCO3</span></div>' +
    '<div class="stat-row"><span class="stat-label">Sulfate : Chloride Ratio</span><span class="stat-value stat-socl">' + (isFinite(d.soCl) ? d.soCl.toFixed(2) : "\u2014") + ' (' + soClDescription(d.soCl) + ')</span></div>' +
    '</div>'
  );
}
function soClDescription(ratio) { if (!isFinite(ratio)) return "sulfate only"; if (ratio < 0.6) return "malty"; if (ratio <= 1.5) return "balanced"; return "hoppy / crisp"; }

// ---- Mash & Ferment tab ----
function mashTabHtml(r, d) {
  const steps = r.mashSteps.map((s, i) =>
    '<div class="mash-step" data-idx="' + i + '">' +
    '<input data-tbl="mashSteps" data-field="name" value="' + escapeHtml(s.name) + '"/>' +
    '<input type="number" data-tbl="mashSteps" data-field="temp" data-unitkind="temp-f" value="' + uVal(s.temp, "temp-f") + '" title="' + uLabel("temp-f") + '"/>' +
    '<input type="number" data-tbl="mashSteps" data-field="time" value="' + s.time + '" title="minutes"/>' +
    '<button class="del-btn" data-del="mashSteps">\u2715</button></div>'
  ).join("");
  const profileOptions = Object.keys(MASH_PROFILES).map(k => '<option ' + (r.mashProfileName === k ? "selected" : "") + '>' + k + '</option>').join("");
  const carbOptions = '<option ' + (r.carbProfileName === "Custom" ? "selected" : "") + '>Custom</option>' + Object.keys(CARBONATION_PROFILES).map(k => '<option ' + (r.carbProfileName === k ? "selected" : "") + '>' + k + '</option>').join("");
  const fermOptions = '<option ' + (r.fermentationProfileName === "Custom" ? "selected" : "") + '>Custom</option>' + Object.keys(FERMENTATION_PROFILES).map(k => '<option ' + (r.fermentationProfileName === k ? "selected" : "") + '>' + k + '</option>').join("");
  const equip = equipmentRef(r.equipmentId);
  return (
    '<div class="card"><h3>Mash Profile</h3><div class="field-grid"><div class="field"><label>Profile</label><select data-field="mashProfileName">' + profileOptions + '</select></div></div>' +
    '<div style="margin-top:16px;">' + steps + '<button class="btn btn-sm add-row-btn" data-action="addMashStep">+ Add Mash Step</button></div></div>' +
    '<div class="card"><h3>Strike Water</h3><div class="field-grid">' +
    '<div class="field"><label>Grain Temp (' + uLabel("temp-f") + ')</label><input type="number" step="1" data-field="grainTempF" data-unitkind="temp-f" value="' + uVal(r.grainTempF, "temp-f") + '"/></div>' +
    '<div class="field" style="display:flex; align-items:flex-end; gap:6px; padding-bottom:6px;"><label style="display:flex; align-items:center; gap:6px; margin:0; text-transform:none; font-size:var(--fs-base); color:var(--ink);" title="' + (equip ? "" : "Link an Equipment Profile on the Design tab to enable this") + '"><input type="checkbox" id="adjustTempForEquip" ' + (r.adjustTempForEquip ? "checked" : "") + ' ' + (equip ? "" : "disabled") + ' title="' + (equip ? "" : "Link an Equipment Profile on the Design tab to enable this") + '"/> Adjust Temp for Equipment</label></div>' +
    '</div>' +
    (equip ? "" : '<p class="hint-text" style="margin:6px 0 0;">Link an Equipment Profile on the Design tab to enable the equipment thermal-mass adjustment.</p>') +
    '<div class="stat-row" style="margin-top:8px;"><span class="stat-label">Water : Grain Ratio</span><span class="stat-value stat-ratio">' + d.ratioQtPerLb.toFixed(2) + ' qt/lb</span></div>' +
    '<div class="stat-row"><span class="stat-label">Calculated Strike Temp</span><span class="stat-value stat-striketemp">' + uVal(d.strikeTempF, "temp-f").toFixed(1) + ' ' + uLabel("temp-f") + '</span></div>' +
    '</div>' +
    '<div class="card"><h3>Carbonation</h3><div class="field-grid">' +
    '<div class="field"><label>Profile</label><select data-field="carbProfileName">' + carbOptions + '</select></div>' +
    '<div class="field"><label>Target Volumes CO2</label><input type="number" step="0.1" data-field="carbLevelVols" value="' + r.carbLevelVols + '"/></div>' +
    '</div></div>' +
    '<div class="card"><h3>Fermentation Profile</h3><div class="field-grid"><div class="field"><label>Profile</label><select data-field="fermentationProfileName">' + fermOptions + '</select></div></div>' +
    '<textarea class="notes-area" style="min-height:80px; margin-top:10px;" data-field="fermentationProfile">' + escapeHtml(r.fermentationProfile) + '</textarea></div>'
  );
}
function notesTabHtml(r) { return '<div class="card"><h3>Brewing Notes</h3><textarea class="notes-area" data-field="notes" placeholder="Tasting notes, process changes, next-batch ideas...">' + escapeHtml(r.notes) + '</textarea></div>'; }

function historyTabHtml(r) {
  const batches = state.batches.filter(b => b.recipeId === r.id).sort((a, b) => (b.brewDate || "").localeCompare(a.brewDate || ""));
  const rows = batches.map(b =>
    '<tr class="history-row" data-batch-id="' + b.id + '" style="cursor:pointer;">' +
    '<td>' + nzDate(b.brewDate) + '</td><td>' + escapeHtml(b.status) + '</td>' +
    '<td class="num">' + (b.measuredOG ? Number(b.measuredOG).toFixed(3) : "\u2014") + '</td>' +
    '<td class="num">' + (b.measuredFG ? Number(b.measuredFG).toFixed(3) : "\u2014") + '</td>' +
    '<td style="max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(b.notes || "") + '</td></tr>'
  ).join("");
  return (
    '<div class="card"><h3>Brew History <button class="btn btn-sm" data-action="startBatchFromRecipe">+ Start New Batch</button></h3>' +
    (batches.length ? '<table class="ing-table"><thead><tr><th>Date</th><th>Status</th><th>Measured OG</th><th>Measured FG</th><th>Notes</th></tr></thead><tbody>' + rows + '</tbody></table>' :
      '<p class="hint-text">No brews logged yet for this recipe. Start a batch to track brew-day readings, and use what you learn to tweak the next version.</p>') +
    '</div>'
  );
}

// ---- Event wiring for recipe tab panel ----
function wireTabEvents(r) {
  const panel = document.getElementById("tabPanel");
  panel.querySelectorAll("[data-field]").forEach(el => {
    if (el.closest("[data-tbl]")) return;
    if (el.dataset.field === "preBoilVolGal") return; // handled specially below (empty = auto)
    if (["yeastAttenuation", "yeastCost", "targetFg"].includes(el.dataset.field)) return; // these don't map to a flat r.<field> path - see dedicated handlers below
    if (el.dataset.field.indexOf("styleOverride.") === 0) return; // wired with "change" below - "input" would rebuild the card mid-keystroke and drop focus
    el.addEventListener("input", () => {
      const path = el.dataset.field;
      let val = el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      setField(r, path, val); saveToStorage(); refreshComputed(r);
    });
  });
  const preBoilEl = panel.querySelector('[data-field="preBoilVolGal"]');
  if (preBoilEl) preBoilEl.addEventListener("input", () => {
    r.preBoilVolGal = preBoilEl.value === "" ? null : Units.toCanonical(Number(preBoilEl.value), "volume-gal", state.unitSystem);
    saveToStorage(); refreshComputed(r);
  });
  panel.querySelectorAll("[data-tbl][data-field]").forEach(el => {
    el.addEventListener("input", () => {
      const tbl = el.dataset.tbl, idx = Number(el.closest("[data-idx]").dataset.idx), field = el.dataset.field;
      let val = el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      r[tbl][idx][field] = val;
      saveToStorage();
      if (field === "use" && tbl === "hops") renderMain(); else refreshComputed(r);
    });
  });
  panel.querySelectorAll("[data-open-picker]").forEach(btn => btn.addEventListener("click", () => {
    const kind = btn.dataset.openPicker;
    if (kind === "style") {
      openIngredientPicker("style", STYLES, r.styleName, false, item => applyStyleChoice(r, item));
    } else if (kind === "yeast") {
      openIngredientPicker("yeast", state.inventory.yeast, r.yeast.name, true, item => applyYeastChoice(r, item));
    } else {
      const idx = Number(btn.closest("[data-idx]").dataset.idx);
      if (kind === "fermentables") {
        openIngredientPicker("fermentables", state.inventory.fermentables, r.fermentables[idx].name, true, item => applyFermentableChoice(r, idx, item));
      } else if (kind === "misc") {
        openIngredientPicker("misc", state.inventory.misc, r.misc[idx].name, true, item => applyMiscChoice(r, idx, item));
      } else {
        openIngredientPicker("hops", state.inventory.hops, r.hops[idx].name, true, item => applyHopChoice(r, idx, item));
      }
    }
  }));
  panel.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", () => {
    const tbl = btn.dataset.del, idx = Number(btn.closest("[data-idx]").dataset.idx);
    r[tbl].splice(idx, 1); saveToStorage(); renderMain();
  }));
  const actions = {
    addFermentable: () => r.fermentables.push({ name: FERMENTABLES[0].name, type: FERMENTABLES[0].type, amountLb: 1, ppg: FERMENTABLES[0].ppg, color: FERMENTABLES[0].srm, mashable: FERMENTABLES[0].mashable, cost: 0 }),
    addHop: () => r.hops.push({ name: HOPS[0].name, amountOz: 1, alphaPct: HOPS[0].alpha, timeMin: 60, use: "Boil", whirlpoolTempF: 194, dryHopDay: null, dryHopDurationDays: null, cost: 0 }),
    addMisc: () => r.misc.push({ name: MISC[0].name, amount: 1, unit: MISC[0].unit, use: MISC[0].use, cost: 0 }),
    addSalt: () => r.waterSalts.push({ name: Object.keys(WATER_SALTS)[0], grams: 1 }),
    addMashStep: () => r.mashSteps.push({ name: "Mash Out", temp: 168, time: 10 }),
    startBatchFromRecipe: () => { const b = newBatch(r.id); state.batches.push(b); state.activeBatchId = b.id; state.activeSection = "batches"; saveToStorage(); renderAll(); },
  };
  panel.querySelectorAll("[data-action]").forEach(btn => { const fn = actions[btn.dataset.action]; if (fn) btn.addEventListener("click", () => { fn(); saveToStorage(); if (state.activeSection === "recipes") renderMain(); else renderAll(); }); });
  panel.querySelectorAll(".history-row").forEach(row => row.addEventListener("click", () => { state.activeBatchId = row.dataset.batchId; state.activeSection = "batches"; saveToStorage(); renderAll(); }));

  const yeastAtt = panel.querySelector('[data-field="yeastAttenuation"]');
  if (yeastAtt) yeastAtt.addEventListener("input", () => { r.yeast.attenuation = Number(yeastAtt.value) / 100; saveToStorage(); refreshComputed(r); });
  const yeastCost = panel.querySelector('[data-field="yeastCost"]');
  if (yeastCost) yeastCost.addEventListener("input", () => { r.yeast.cost = Number(yeastCost.value); saveToStorage(); refreshComputed(r); });
  const targetFgInput = panel.querySelector('[data-field="targetFg"]');
  if (targetFgInput) targetFgInput.addEventListener("change", () => { applyTargetFg(r, Number(targetFgInput.value)); saveToStorage(); renderMain(); });
  const matchStyleFgBtn = panel.querySelector('[data-action="matchStyleFg"]');
  if (matchStyleFgBtn) matchStyleFgBtn.addEventListener("click", () => {
    const style = styleRef(r.styleName);
    if (!style) return;
    applyTargetFg(r, (style.fg[0] + style.fg[1]) / 2);
    saveToStorage(); renderMain();
  });

  const equipSel = panel.querySelector('[data-field="equipmentId"]');
  if (equipSel) equipSel.addEventListener("change", () => {
    r.equipmentId = equipSel.value || null;
    const eq = equipmentRef(r.equipmentId);
    if (eq) { r.batchVolGal = eq.batchVolGal; r.boilTimeMin = eq.boilTimeMin; r.efficiencyPct = eq.mashEfficiencyPct; r.spargeWaterVolGal = eq.trubLossGal + (eq.boilOffRateGalHr * eq.boilTimeMin / 60); }
    saveToStorage(); renderMain();
    if (eq) toast('Applied "' + eq.name + '" equipment defaults');
  });
  const mashProfileSel = panel.querySelector('[data-field="mashProfileName"]');
  if (mashProfileSel) mashProfileSel.addEventListener("change", () => { r.mashProfileName = mashProfileSel.value; r.mashSteps = JSON.parse(JSON.stringify(MASH_PROFILES[r.mashProfileName])); saveToStorage(); renderMain(); });
  const targetSel = document.getElementById("targetProfileSelect");
  if (targetSel) targetSel.addEventListener("change", () => { r.waterTarget = targetSel.value; r.waterSalts = []; r.waterBase = Object.assign({}, WATER_TARGET_PROFILES[targetSel.value]); saveToStorage(); renderMain(); toast("Matched to " + targetSel.value + " profile"); });

  const adjustEquipCb = panel.querySelector("#adjustTempForEquip");
  if (adjustEquipCb) adjustEquipCb.addEventListener("change", () => { r.adjustTempForEquip = adjustEquipCb.checked; saveToStorage(); renderMain(); });
  const carbSel = panel.querySelector('[data-field="carbProfileName"]');
  if (carbSel) carbSel.addEventListener("change", () => {
    r.carbProfileName = carbSel.value;
    if (CARBONATION_PROFILES[carbSel.value] != null) r.carbLevelVols = CARBONATION_PROFILES[carbSel.value];
    saveToStorage(); renderMain();
  });
  const fermProfileSel = panel.querySelector('[data-field="fermentationProfileName"]');
  if (fermProfileSel) fermProfileSel.addEventListener("change", () => {
    r.fermentationProfileName = fermProfileSel.value;
    if (FERMENTATION_PROFILES[fermProfileSel.value]) r.fermentationProfile = FERMENTATION_PROFILES[fermProfileSel.value];
    saveToStorage(); renderMain();
  });

  // ---- Save Item (personal ingredient library) ----
  panel.querySelectorAll("[data-save-item]").forEach(btn => btn.addEventListener("click", () => {
    saveItemToLibrary(btn.dataset.saveItem, btn.closest("[data-idx]"), r);
  }));

  // ---- Style Guide Comparison: manual override inputs/clear buttons ----
  wireStyleOverrideEvents(panel, r);
}

// ---- Rich picker modal ----
// Replaces the old plain <select> dropdowns (and the old right-click Substitute context menu)
// for Style/Fermentables/Hops/Yeast: a searchable, region-grouped list showing each item's
// key spec and (for inventory-backed kinds) its current stock level, so a long catalogue is
// actually browsable instead of just an alphabetical wall of names in a <select>.

function pickerItemMeta(kind, item) {
  if (kind === "style") {
    return item.og[0].toFixed(3) + "\u2013" + item.og[1].toFixed(3) + " OG \u00b7 " + item.ibu[0] + "\u2013" + item.ibu[1] + " IBU \u00b7 " +
      uVal(item.srm[0], "color-srm").toFixed(0) + "\u2013" + uVal(item.srm[1], "color-srm").toFixed(0) + " " + uLabel("color-srm") + " \u00b7 " +
      item.abv[0].toFixed(1) + "\u2013" + item.abv[1].toFixed(1) + "% ABV";
  }
  if (kind === "fermentables") return item.type + " \u00b7 " + item.ppg + " PPG \u00b7 " + uVal(item.srm, "color-srm").toFixed(1) + " " + uLabel("color-srm");
  if (kind === "hops") return item.alpha.toFixed(1) + "% alpha acid";
  if (kind === "misc") return "Typical unit: " + item.unit + " \u00b7 Usually added at " + item.use;
  return item.type + " \u00b7 " + Math.round(item.attenuation * 100) + "% attenuation"; // yeast
}
function pickerItemGroup(kind, item) { return kind === "style" ? (item.category || "Other") : (item.origin || "Custom"); }
function pickerStockBadge(kind, item) {
  if (kind === "style" || item.stock == null) return "";
  const low = Number(item.stock) <= 0;
  return '<span class="picker-stock' + (low ? " low" : "") + '">' + (low ? "Out of stock" : item.stock + " " + escapeHtml(item.unit || "")) + '</span>';
}

// kind: "style" | "fermentables" | "hops" | "yeast". library: array to list (STYLES, or
// state.inventory.<kind>). currentName: pre-selected item, for highlighting. allowCustom:
// whether "type a new name" is offered (not applicable to style). onSelect(item|name) fires
// with either the matched catalogue/inventory object, or a plain string for a new custom name.
function openIngredientPicker(kind, library, currentName, allowCustom, onSelect) {
  const groups = new Map();
  library.forEach(item => {
    const g = pickerItemGroup(kind, item);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(item);
  });
  const knownGroups = kind === "style"
    ? Array.from(new Set(library.map(s => s.category || "Other")))
    : REGIONS;
  const order = kind === "style" ? knownGroups : [state.region].concat(REGIONS.filter(x => x !== state.region));
  const renderList = (filterText) => {
    const q = (filterText || "").trim().toLowerCase();
    let html = "";
    let anyMatch = false;
    order.forEach(g => {
      const items = (groups.get(g) || []).filter(item => !q || item.name.toLowerCase().indexOf(q) !== -1);
      if (!items.length) return;
      anyMatch = true;
      html += '<div class="picker-group-label">' + escapeHtml(g) + '</div>';
      html += items.map(item =>
        '<div class="picker-row' + (item.name === currentName ? " current" : "") + '" data-picker-name="' + escapeHtml(item.name) + '">' +
        '<div class="picker-row-main"><div class="picker-row-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="picker-row-meta">' + escapeHtml(pickerItemMeta(kind, item)) + '</div></div>' +
        pickerStockBadge(kind, item) +
        '</div>'
      ).join("");
    });
    return anyMatch ? html : '<p style="color:var(--ink-faint);font-size:var(--fs-base);padding:8px 2px;">No matches.</p>';
  };
  const title = { style: "Choose a Style", fermentables: "Choose a Fermentable", hops: "Choose a Hop", yeast: "Choose a Yeast Strain", misc: "Choose a Misc / Fining Item" }[kind];
  const html =
    '<h3>' + title + '</h3>' +
    '<input type="text" class="picker-search" placeholder="Search by name\u2026" autofocus/>' +
    (allowCustom ? '<button class="btn btn-sm" data-picker-custom style="margin:8px 0;">+ Type a Custom Name\u2026</button>' : "") +
    '<div class="picker-list">' + renderList("") + '</div>';
  showModal(html, (overlay) => {
    const searchEl = overlay.querySelector(".picker-search");
    const listEl = overlay.querySelector(".picker-list");
    const wireRows = () => {
      listEl.querySelectorAll("[data-picker-name]").forEach(row => row.addEventListener("click", () => {
        const item = library.find(x => x.name === row.dataset.pickerName);
        closeModal();
        if (item) onSelect(item);
      }));
    };
    wireRows();
    searchEl.addEventListener("input", () => { listEl.innerHTML = renderList(searchEl.value); wireRows(); });
    searchEl.focus();
    const customBtn = overlay.querySelector("[data-picker-custom]");
    if (customBtn) customBtn.addEventListener("click", async () => {
      const kindLabel = kind === "fermentables" ? "fermentable" : kind === "hops" ? "hop" : kind === "misc" ? "misc/fining item" : "yeast strain";
      const name = await showPromptModal("Custom " + kindLabel, "Name", "", { confirmLabel: "Add" });
      if (name) onSelect(name);
    });
  }, "picker-modal");
}

// ---- Apply a chosen ingredient (from the picker) to a recipe row/field ----
// item is either a matched library object, or a plain string for a brand-new custom name.
function applyFermentableChoice(r, idx, item) {
  snapshotUndo(r);
  if (typeof item === "string") {
    r.fermentables[idx].name = item;
    state.inventory.fermentables.push(Object.assign(newInventoryItem("fermentables"), { name: item }));
  } else {
    Object.assign(r.fermentables[idx], { name: item.name, ppg: item.ppg, color: item.srm, type: item.type, mashable: item.mashable });
  }
  saveToStorage(); renderMain(); toast("Set " + (typeof item === "string" ? item : item.name));
}
function applyMiscChoice(r, idx, item) {
  snapshotUndo(r);
  if (typeof item === "string") {
    r.misc[idx].name = item;
    state.inventory.misc.push(Object.assign(newInventoryItem("misc"), { name: item }));
  } else {
    r.misc[idx].name = item.name; r.misc[idx].unit = item.unit; r.misc[idx].use = item.use;
  }
  saveToStorage(); renderMain(); toast("Set " + (typeof item === "string" ? item : item.name));
}
function applyHopChoice(r, idx, item) {
  snapshotUndo(r);
  if (typeof item === "string") {
    r.hops[idx].name = item;
    state.inventory.hops.push(Object.assign(newInventoryItem("hops"), { name: item }));
  } else {
    r.hops[idx].name = item.name; r.hops[idx].alphaPct = item.alpha;
  }
  saveToStorage(); renderMain(); toast("Set " + (typeof item === "string" ? item : item.name));
}
function applyYeastChoice(r, item) {
  snapshotUndo(r);
  if (typeof item === "string") {
    r.yeast.name = item;
    state.inventory.yeast.push(Object.assign(newInventoryItem("yeast"), { name: item }));
  } else {
    r.yeast.name = item.name; r.yeast.attenuation = item.attenuation; r.yeast.type = item.type;
  }
  saveToStorage(); renderMain(); toast("Set " + (typeof item === "string" ? item : item.name));
}
function applyStyleChoice(r, item) {
  r.styleName = item.name;
  saveToStorage(); renderMain();
}

function saveItemToLibrary(kind, rowEl, r) {
  let entry;
  if (kind === "fermentables") {
    const idx = Number(rowEl.dataset.idx);
    const f = r.fermentables[idx];
    entry = { name: f.name, type: f.type, ppg: f.ppg, srm: f.color, mashable: f.mashable };
  } else if (kind === "hops") {
    const idx = Number(rowEl.dataset.idx);
    const h = r.hops[idx];
    entry = { name: h.name, alpha: h.alphaPct };
  } else {
    entry = { name: r.yeast.name, type: r.yeast.type, attenuation: r.yeast.attenuation };
  }
  if (!entry.name) { toast("Give it a name first"); return; }
  const catalogue = { fermentables: FERMENTABLES, hops: HOPS, yeast: YEASTS, misc: MISC }[kind];
  const catalogueMatch = catalogue.find(x => x.name.toLowerCase() === entry.name.toLowerCase());
  if (catalogueMatch && catalogueMatch.origin) entry.origin = catalogueMatch.origin;
  const list = state.inventory[kind];
  const existingIdx = list.findIndex(x => x.name.toLowerCase() === entry.name.toLowerCase());
  if (existingIdx !== -1) Object.assign(list[existingIdx], entry); else list.push(Object.assign(newInventoryItem(kind), entry));
  saveToStorage();
  toast('Saved "' + entry.name + '" to inventory');
}

function setField(r, path, val) { if (path.indexOf(".") !== -1) { const parts = path.split("."); r[parts[0]][parts[1]] = val; } else r[path] = val; }

function refreshComputed(r) {
  const d = computeDerived(r);
  const style = styleRef(r.styleName);
  const stripHolder = document.querySelector(".gauge-strip");
  if (stripHolder) stripHolder.outerHTML = renderGaugeStrip(d, style);
  const bannerHolder = document.querySelector(".sanity-banner");
  const freshBanner = renderSanityBanner(d, r);
  if (bannerHolder) {
    if (freshBanner) bannerHolder.outerHTML = freshBanner;
    else bannerHolder.remove();
  } else if (freshBanner) {
    const strip = document.querySelector(".gauge-strip");
    if (strip) strip.insertAdjacentHTML("afterend", freshBanner);
  }

  if (state.activeTab === "design") {
    const headers = Array.from(document.querySelectorAll(".card h3")).filter(h => h.textContent.indexOf("Style Guide") === 0);
    if (headers[0]) {
      const styleCard = headers[0].closest(".card");
      styleCard.innerHTML = '<h3>Style Guide Comparison</h3>' + (style ? styleCompareHtml(r, style) : '<p class="hint-text">Pick a style above to compare.</p>');
      if (style) wireStyleOverrideEvents(styleCard, r);
    }
    document.querySelectorAll(".grist-pct").forEach((el, i) => { if (d.grainPercents[i] != null) el.textContent = d.grainPercents[i].toFixed(1) + "%"; });
    document.querySelectorAll(".hop-ibu").forEach((el, i) => { if (d.ibuBreakdown[i] != null) el.textContent = d.ibuBreakdown[i].toFixed(1); });
    const preBoil = document.querySelector(".preboil-gravity");
    if (preBoil) preBoil.textContent = d.preBoilGravity.toFixed(3) + " (at " + uVal(d.preBoilVolGal, "volume-gal").toFixed(2) + " " + uLabel("volume-gal") + ")";
    const lbBbl = document.querySelector(".lb-per-barrel");
    if (lbBbl) lbBbl.textContent = uVal(d.poundsPerBarrel, "weight-lb").toFixed(2);
    const totalCost = document.querySelector(".total-cost");
    if (totalCost) totalCost.textContent = "$" + d.cost.toFixed(2);
  }

  if (state.activeTab === "water") {
    document.querySelectorAll('.ion-value[data-ion-group="mash"]').forEach(el => { el.textContent = Math.round(d.finalWater[el.dataset.ion]); });
    document.querySelectorAll('.ion-value[data-ion-group="sparge"]').forEach(el => { el.textContent = Math.round(d.finalSpargeWater[el.dataset.ion]); });
    const ra = document.querySelector(".stat-ra"); if (ra) ra.textContent = d.ra.toFixed(1) + " ppm as CaCO3";
    const alk = document.querySelector(".stat-alk"); if (alk) alk.textContent = d.alkalinity.toFixed(1) + " ppm as CaCO3";
    const hard = document.querySelector(".stat-hardness"); if (hard) hard.textContent = d.hardness.toFixed(1) + " ppm as CaCO3";
    const soCl = document.querySelector(".stat-socl"); if (soCl) soCl.textContent = (isFinite(d.soCl) ? d.soCl.toFixed(2) : "\u2014") + " (" + soClDescription(d.soCl) + ")";
  }

  if (state.activeTab === "mash") {
    const ratio = document.querySelector(".stat-ratio"); if (ratio) ratio.textContent = d.ratioQtPerLb.toFixed(2) + " qt/lb";
    const strike = document.querySelector(".stat-striketemp"); if (strike) strike.textContent = uVal(d.strikeTempF, "temp-f").toFixed(1) + " " + uLabel("temp-f");
  }

  renderSidebar();
}

function handleNewRecipe() {
  const r = newRecipe();
  r.name = uniqueSiblingName(state.tree, "recipe", r.name);
  state.recipes.push(r); addLeafToRoot(r.id);
  state.activeId = r.id; state.activeTab = "design";
  saveToStorage(); renderAll(); toast("New recipe created");
}

// ================= BATCHES =================
function renderBatchesMain(main) {
  if (!state.recipes.length) { main.innerHTML = '<div class="empty-state"><h2>No recipes yet</h2><p>Create a recipe first, then start a batch from it to track an actual brew day.</p></div>'; return; }
  const b = activeBatch();
  if (!b) {
    main.innerHTML = '<div class="empty-state"><h2>No batch selected</h2><p>Start a new batch from one of your recipes to log brew day readings and progress.</p><button class="btn btn-primary" id="emptyNewBatchBtn">+ New Batch</button></div>';
    document.getElementById("emptyNewBatchBtn").addEventListener("click", handleNewBatch);
    return;
  }
  const r = state.recipes.find(x => x.id === b.recipeId);
  const d = r ? computeDerived(r) : null;
  const statuses = ["Planning", "Brewing", "Fermenting", "Completed"];
  const statusBtns = statuses.map(s => '<button class="btn ' + (b.status === s ? "btn-primary" : "") + '" data-status="' + s + '" style="flex:1; min-width:100px;">' + s + '</button>').join("");
  const recipeOptions = state.recipes.map(rc => '<option value="' + rc.id + '" ' + (rc.id === b.recipeId ? "selected" : "") + '>' + escapeHtml(rc.name) + '</option>').join("");

  const ageDays = Math.max(0, Math.round((Date.now() - new Date(b.brewDate + "T00:00:00").getTime()) / 86400000));
  const ageBadge = '<span class="batch-age-badge" title="Days since brew date">' + ageDays + ' day' + (ageDays === 1 ? "" : "s") + ' old</span>';

  // ---- Mash efficiency (from measured pre-boil gravity/volume) ----
  const ferms = r ? r.fermentables.map(f => ({ amountLb: Number(f.amountLb) || 0, ppg: Number(f.ppg) || 0 })) : [];
  const measMashEff = r && b.measuredPreBoilGravity && b.measuredPreBoilVolGal ? Calc.measuredEfficiency(ferms, Number(b.measuredPreBoilGravity), Number(b.measuredPreBoilVolGal)) : null;

  // ---- Brewhouse efficiency / attenuation / calories (from measured OG/FG/batch size) ----
  const measBhEff = r && b.measuredOG && b.measuredBatchSizeGal ? Calc.measuredEfficiency(ferms, Number(b.measuredOG), Number(b.measuredBatchSizeGal)) : null;
  const estAttenuation = d ? Calc.attenuationPct(d.og, d.fg) : null;
  const measAttenuation = b.measuredOG && b.measuredFG ? Calc.attenuationPct(Number(b.measuredOG), Number(b.measuredFG)) : null;
  const estCalories = d ? Calc.estimateCalories(d.og, d.fg) : null;
  const measCalories = b.measuredOG && b.measuredFG ? Calc.estimateCalories(Number(b.measuredOG), Number(b.measuredFG)) : null;

  // ---- Bottling/kegging carbonation (falls back to the recipe's own carb card if not overridden) ----
  const carbTargetVols = b.carbTargetVols != null ? Number(b.carbTargetVols) : (r ? Number(r.carbLevelVols) : 2.4);
  const carbTempF = b.carbTempF != null ? Number(b.carbTempF) : 68;
  const carbBatchGal = b.measuredBottlingVolGal != null ? Number(b.measuredBottlingVolGal) : (r ? Number(r.batchVolGal) : null);
  const carbOutput = carbBatchGal ? (b.carbMethod === "Bottle"
    ? Calc.primingSugarGrams(carbBatchGal, carbTempF, carbTargetVols).toFixed(0) + " g corn sugar (" + (Calc.primingSugarGrams(carbBatchGal, carbTempF, carbTargetVols) / 28.3495).toFixed(2) + " oz)"
    : Calc.kegCarbPSI(carbTempF, carbTargetVols).toFixed(1) + " PSI") : "\u2014";
  const canDeduct = statuses.indexOf(b.status) >= statuses.indexOf("Brewing");
  const suggested = suggestedNextStatus(b);
  const showSuggestBanner = suggested && b.suggestionDismissed !== suggested;

  main.innerHTML =
    '<div class="recipe-header"><div><div class="item-eyebrow">Batch \u00b7 Brew Day</div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><h1 class="display" style="margin:0;font-size:var(--fs-display-sm);">' + escapeHtml(batchDisplayName(b)) + '</h1>' + ageBadge + '</div></div><div class="header-actions"><button class="btn btn-sm" id="rebrewBtn" title="Start a fresh batch of the same recipe">Rebrew</button><button class="btn btn-sm" id="shareBatchBtn">Share</button><button class="btn btn-sm btn-danger" id="deleteBatchBtn">Delete Batch</button></div></div>' +
    (showSuggestBanner ? '<div class="suggest-banner"><span class="suggest-icon">\ud83d\udca1</span><span class="suggest-text">This batch looks like it\u2019s moved on \u2014 move to <strong>' + suggested + '</strong>?</span><div class="suggest-actions"><button class="btn btn-sm btn-primary" id="acceptSuggestBtn">Move to ' + suggested + '</button><button class="btn btn-sm" id="dismissSuggestBtn">Not now</button></div></div>' : "") +
    '<div class="card"><h3>Status</h3><div style="display:flex; gap:8px; flex-wrap:wrap;">' + statusBtns + '</div></div>' +
    '<div class="card"><h3>Brew Day</h3><div class="field-grid">' +
    '<div class="field"><label>Recipe</label><select id="batchRecipeSelect">' + recipeOptions + '</select></div>' +
    '<div class="field"><label>Brew Date</label><input type="date" data-bfield="brewDate" value="' + b.brewDate + '"/></div>' +
    '<div class="field"><label>Start Time</label><input type="time" data-bfield="brewStartTime" value="' + (b.brewStartTime || "") + '"/></div>' +
    '<div class="field"><label>End Time</label><input type="time" data-bfield="brewEndTime" value="' + (b.brewEndTime || "") + '"/></div>' +
    '<div class="field"><label>Measured OG</label><input type="number" step="0.001" data-bfield="measuredOG" value="' + (b.measuredOG != null ? b.measuredOG : "") + '" placeholder="' + (d ? d.og.toFixed(3) : "1.050") + '"/></div>' +
    '<div class="field"><label>Measured FG</label><input type="number" step="0.001" data-bfield="measuredFG" value="' + (b.measuredFG != null ? b.measuredFG : "") + '" placeholder="' + (d ? d.fg.toFixed(3) : "1.010") + '"/></div>' +
    '</div></div>' +
    '<div class="card"><h3>Ingredients Needed <span><button class="btn btn-sm" id="deductInventoryBtn" ' + (canDeduct ? "" : 'disabled title="Available once this batch reaches Brewing"') + '>' + (b.inventoryDeducted ? "\u2713 Deducted" : "Deduct from Inventory") + '</button></span></h3>' +
    (r ? '<table class="ing-table"><tbody>' +
      r.fermentables.map(f => '<tr><td>' + escapeHtml(f.name) + '</td><td class="num">' + uVal(f.amountLb, "weight-lb").toFixed(2) + ' ' + uLabel("weight-lb") + '</td></tr>').join("") +
      r.hops.map(h => '<tr><td>' + escapeHtml(h.name) + '</td><td class="num">' + uVal(h.amountOz, "weight-oz").toFixed(2) + ' ' + uLabel("weight-oz") + '</td></tr>').join("") +
      '<tr><td>' + escapeHtml(r.yeast.name) + '</td><td class="num">1 pkg</td></tr></tbody></table>' : '<p style="color:var(--ink-faint);">Original recipe was deleted.</p>') +
    '</div>' +
    (d ? '<div class="card"><h3>Mash &amp; Pre-Boil</h3><div class="field-grid">' +
      '<div class="field"><label>Measured Pre-Boil Gravity</label><input type="number" step="0.001" data-bfield="measuredPreBoilGravity" value="' + (b.measuredPreBoilGravity != null ? b.measuredPreBoilGravity : "") + '" placeholder="' + d.preBoilGravity.toFixed(3) + '"/></div>' +
      '<div class="field"><label>Measured Pre-Boil Volume (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-bfield="measuredPreBoilVolGal" data-unitkind="volume-gal" value="' + (b.measuredPreBoilVolGal != null ? uVal(b.measuredPreBoilVolGal, "volume-gal") : "") + '" placeholder="' + uVal(d.preBoilVolGal, "volume-gal").toFixed(1) + '"/></div>' +
      '</div>' +
      batchCompareRow("Pre-Boil Gravity", d.preBoilGravity.toFixed(3), b.measuredPreBoilGravity ? Number(b.measuredPreBoilGravity).toFixed(3) : null) +
      batchCompareRow("Mash Efficiency", (Number(r.efficiencyPct) || 0).toFixed(1) + "%", measMashEff != null ? measMashEff.toFixed(1) + "%" : null) +
      '</div>' : "") +
    (d ? '<div class="card"><h3>Into Fermenter &amp; Efficiency</h3><div class="field-grid">' +
      '<div class="field"><label>Measured Batch Size (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-bfield="measuredBatchSizeGal" data-unitkind="volume-gal" value="' + (b.measuredBatchSizeGal != null ? uVal(b.measuredBatchSizeGal, "volume-gal") : "") + '" placeholder="' + uVal(r.batchVolGal, "volume-gal").toFixed(1) + '"/></div>' +
      '</div>' +
      batchCompareRow("Original Gravity", d.og.toFixed(3), b.measuredOG ? Number(b.measuredOG).toFixed(3) : null) +
      batchCompareRow("Final Gravity", d.fg.toFixed(3), b.measuredFG ? Number(b.measuredFG).toFixed(3) : null) +
      (b.measuredOG && b.measuredFG ? batchCompareRow("ABV", d.abv.toFixed(1) + "%", Calc.estimateABV(Number(b.measuredOG), Number(b.measuredFG)).toFixed(1) + "%") : "") +
      (estAttenuation != null ? batchCompareRow("Attenuation", estAttenuation.toFixed(1) + "%", measAttenuation != null ? measAttenuation.toFixed(1) + "%" : null) : "") +
      batchCompareRow("Brewhouse Efficiency", (Number(r.efficiencyPct) || 0).toFixed(1) + "%", measBhEff != null ? measBhEff.toFixed(1) + "%" : null) +
      (estCalories != null ? batchCompareRow("Calories (per 12oz)", estCalories.toFixed(0) + " kcal", measCalories != null ? measCalories.toFixed(0) + " kcal" : null) : "") +
      '</div>' : "") +
    '<div class="card"><h3>Fermentation Readings <span><button class="btn btn-sm" id="importTiltBtn">Import CSV</button> <button class="btn btn-sm" id="addReadingBtn">+ Add Reading</button></span></h3>' +
    '<input type="file" id="tiltFileInput" accept=".csv,text/csv" style="display:none;"/>' +
    fermentationChartSvg(b.fermentationReadings) +
    (b.fermentationReadings.length ? '<table class="ing-table ferm-readings-table"><thead><tr><th>Date</th><th>Time</th><th>Temp (' + uLabel("temp-f") + ')</th><th>Gravity</th><th>Notes</th><th></th></tr></thead><tbody>' +
      [...b.fermentationReadings].sort((x, y) => ((x.date || "") + (x.time || "")).localeCompare((y.date || "") + (y.time || ""))).map(fr =>
        '<tr data-reading-id="' + fr.id + '">' +
        '<td><input type="date" data-rfield="date" value="' + (fr.date || "") + '"/></td>' +
        '<td><input type="time" data-rfield="time" value="' + (fr.time || "") + '"/></td>' +
        '<td><input type="number" step="1" data-rfield="tempF" data-unitkind="temp-f" value="' + (fr.tempF != null ? uVal(fr.tempF, "temp-f") : "") + '"/></td>' +
        '<td><input type="number" step="0.001" data-rfield="gravity" value="' + (fr.gravity != null ? fr.gravity : "") + '"/></td>' +
        '<td><input type="text" data-rfield="notes" value="' + escapeHtml(fr.notes || "") + '" placeholder="e.g. krausen dropped"/></td>' +
        '<td><button class="del-btn" data-del-reading="' + fr.id + '">\u2715</button></td></tr>'
      ).join("") + '</tbody></table>' : '<p class="hint-text">No readings yet \u2014 add one manually or import a Tilt hydrometer CSV export.</p>') +
    '</div>' +
    '<div class="card"><h3>Bottling / Kegging</h3><div class="field-grid">' +
    '<div class="field"><label>Vessel Size</label><select id="vesselSizeSelect"><option value="">\u2014 pick a vessel to set volume \u2014</option>' + state.packaging.map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (' + uVal(p.volGal, "volume-gal").toFixed(2) + ' ' + uLabel("volume-gal") + ')</option>').join("") + '</select></div>' +
    '<div class="field"><label>Measured Bottling/Kegging Volume (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-bfield="measuredBottlingVolGal" data-unitkind="volume-gal" value="' + (b.measuredBottlingVolGal != null ? uVal(b.measuredBottlingVolGal, "volume-gal") : "") + '" placeholder="' + (r ? uVal(r.batchVolGal, "volume-gal").toFixed(1) : "") + '"/></div>' +
    '<div class="field"><label>Method</label><select data-bfield="carbMethod"><option ' + (b.carbMethod === "Keg" ? "selected" : "") + '>Keg</option><option ' + (b.carbMethod === "Bottle" ? "selected" : "") + '>Bottle</option></select></div>' +
    '<div class="field"><label>Target Volumes CO2</label><input type="number" step="0.1" data-bfield="carbTargetVols" value="' + (b.carbTargetVols != null ? b.carbTargetVols : "") + '" placeholder="' + carbTargetVols.toFixed(1) + '"/></div>' +
    '<div class="field"><label>Beer Temp (' + uLabel("temp-f") + ')</label><input type="number" step="1" data-bfield="carbTempF" data-unitkind="temp-f" value="' + (b.carbTempF != null ? uVal(b.carbTempF, "temp-f") : "") + '" placeholder="' + uVal(carbTempF, "temp-f").toFixed(0) + '"/></div>' +
    '</div><div class="stat-row" style="margin-top:8px;"><span class="stat-label">' + (b.carbMethod === "Bottle" ? "Priming Sugar Needed" : "Keg Pressure Needed") + '</span><span class="stat-value">' + carbOutput + '</span></div>' +
    '</div>' +
    '<div class="card"><h3>Batch Notes</h3><textarea class="notes-area" id="batchNotes" placeholder="Brew day observations, gravity readings, off-flavours, timing...">' + escapeHtml(b.notes) + '</textarea></div>';

  main.querySelectorAll("[data-status]").forEach(btn => btn.addEventListener("click", () => attemptStatusChange(b, r, btn.dataset.status)));
  if (showSuggestBanner) {
    document.getElementById("acceptSuggestBtn").addEventListener("click", () => { b.suggestionDismissed = null; attemptStatusChange(b, r, suggested); });
    document.getElementById("dismissSuggestBtn").addEventListener("click", () => { b.suggestionDismissed = suggested; saveToStorage(); renderMain(); });
  }
  document.getElementById("shareBatchBtn").addEventListener("click", () => shareBatch(b));
  document.getElementById("rebrewBtn").addEventListener("click", () => rebrewBatch(b));
  document.getElementById("deleteBatchBtn").addEventListener("click", async () => {
    const ok = await showConfirmModal("Delete Batch?", "Delete this batch record? This can't be undone.", { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    state.batches = state.batches.filter(x => x.id !== b.id);
    state.activeBatchId = state.batches.length ? state.batches[0].id : null;
    saveToStorage(); renderAll();
  });
  document.getElementById("batchRecipeSelect").addEventListener("change", e => {
    b.recipeId = e.target.value;
    const found = state.recipes.find(x => x.id === b.recipeId);
    b.recipeName = found ? found.name : "Unknown Recipe";
    saveToStorage(); renderAll();
  });
  // "change" (fires on blur/Enter), not "input" - these trigger a full renderMain() to refresh
  // the estimated-vs-actual/efficiency numbers elsewhere on the tab, and "input" would rebuild
  // the field out from under the user's cursor after every keystroke (same fix as the Style
  // Guide override inputs).
  main.querySelectorAll("[data-bfield]").forEach(el => el.addEventListener("change", () => {
    let val = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
    if (val != null && el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
    b[el.dataset.bfield] = val; saveToStorage();
    if (el.dataset.bfield !== "brewDate" && el.dataset.bfield !== "notes") renderMain(); else renderSidebar();
  }));
  document.getElementById("batchNotes").addEventListener("input", e => { b.notes = e.target.value; saveToStorage(); });
  document.getElementById("deductInventoryBtn").addEventListener("click", () => deductInventoryForBatch(r, b));
  document.getElementById("vesselSizeSelect").addEventListener("change", e => {
    const vessel = state.packaging.find(p => p.id === e.target.value);
    if (!vessel) return;
    b.measuredBottlingVolGal = vessel.volGal;
    saveToStorage(); renderMain();
  });

  // ---- Fermentation readings: add/edit/delete + CSV import ----
  document.getElementById("addReadingBtn").addEventListener("click", () => {
    b.fermentationReadings.push({ id: uid(), date: new Date().toISOString().slice(0, 10), tempF: null, gravity: null, notes: "" });
    saveToStorage(); renderMain();
  });
  main.querySelectorAll("[data-del-reading]").forEach(btn => btn.addEventListener("click", () => {
    b.fermentationReadings = b.fermentationReadings.filter(fr => fr.id !== btn.dataset.delReading);
    saveToStorage(); renderMain();
  }));
  main.querySelectorAll("[data-reading-id]").forEach(row => {
    const fr = b.fermentationReadings.find(x => x.id === row.dataset.readingId);
    row.querySelectorAll("[data-rfield]").forEach(el => el.addEventListener("change", () => {
      let val = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
      if (val != null && el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      fr[el.dataset.rfield] = val;
      saveToStorage(); renderMain();
    }));
  });
  const tiltInput = document.getElementById("tiltFileInput");
  document.getElementById("importTiltBtn").addEventListener("click", () => tiltInput.click());
  tiltInput.addEventListener("change", () => {
    const file = tiltInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseTiltCsv(String(reader.result));
      if (!rows.length) { toast("No readings found in that CSV"); return; }
      b.fermentationReadings.push(...rows);
      saveToStorage(); renderMain();
      toast("Imported " + rows.length + " reading(s)");
    };
    reader.readAsText(file);
    tiltInput.value = "";
  });
}
function batchCompareRow(label, est, actual) { return '<div class="stat-row"><span class="stat-label">' + label + '</span><span class="stat-value">' + est + ' est' + (actual ? ' \u2192 ' + actual + ' actual' : "") + '</span></div>'; }
const BATCH_STATUSES = ["Planning", "Brewing", "Fermenting", "Completed"];
// Heuristics for "this batch looks like it's moved on" - shown as a dismissible banner rather
// than auto-changing status outright, since the data appearing doesn't necessarily mean the
// brewer wants the status bumped right this second (per user preference: suggest, don't force).
function suggestedNextStatus(b) {
  if (b.status === "Planning" && (b.brewStartTime || b.measuredPreBoilGravity != null || b.measuredPreBoilVolGal != null || b.measuredOG != null)) return "Brewing";
  if (b.status === "Brewing" && (b.fermentationReadings.length > 0 || b.measuredBatchSizeGal != null)) return "Fermenting";
  if (b.status === "Fermenting" && (b.measuredFG != null || b.measuredBottlingVolGal != null)) return "Completed";
  return null;
}
function attemptStatusChange(b, r, newStatus) {
  if (newStatus === b.status) return;
  const movingForward = BATCH_STATUSES.indexOf(newStatus) > BATCH_STATUSES.indexOf(b.status);
  if (!movingForward) { b.status = newStatus; saveToStorage(); renderAll(); return; } // moving backward needs no readiness checks

  const missing = [];
  if (newStatus === "Brewing" && r) {
    Calc.recipeChecks(computeDerived(r), r, styleRef(r.styleName)).filter(c => c.severity === "error").forEach(e => missing.push(e.message));
  }
  if (newStatus === "Fermenting" && b.measuredOG == null) missing.push("No Measured OG has been entered yet.");
  if (newStatus === "Completed") {
    if (!b.fermentationReadings.length) missing.push("No fermentation readings have been logged.");
    if (b.measuredFG == null) missing.push("No Measured FG has been entered yet.");
  }

  const commit = () => { b.status = newStatus; b.suggestionDismissed = null; saveToStorage(); renderAll(); };

  // Moving to Completed without having deducted inventory gets its own explicit prompt (per
  // spec) rather than folding into the generic confirm() below - it's common enough to forget,
  // and "Ignore" vs "Deduct Now" are both reasonable, so it deserves real buttons instead of a
  // single OK/Cancel.
  if (newStatus === "Completed" && !b.inventoryDeducted) {
    const missingHtml = missing.length ? '<ul>' + missing.map(m => "<li>" + escapeHtml(m) + "</li>").join("") + "</ul>" : "";
    showModal(
      '<h3>Before marking this batch Completed</h3>' +
      '<div class="modal-body-text"><p>This batch\u2019s ingredients haven\u2019t been deducted from inventory yet \u2014 don\u2019t forget!</p>' + missingHtml + '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn" id="ignoreDeductBtn">Ignore &amp; Continue</button>' +
      '<button class="btn btn-primary" id="deductNowBtn">Deduct Now</button>' +
      '</div>',
      overlay => {
        overlay.querySelector("#deductNowBtn").addEventListener("click", () => { closeModal(); deductInventoryForBatch(r, b); commit(); });
        overlay.querySelector("#ignoreDeductBtn").addEventListener("click", () => { closeModal(); commit(); });
      }
    );
    return;
  }

  if (missing.length) {
    // Soft warning only - OK proceeds without requiring the missing data to be filled in first,
    // Cancel (or clicking outside) just stays on the current status.
    showConfirmModal(
      "Before moving to " + newStatus,
      "<ul>" + missing.map(m => "<li>" + escapeHtml(m) + "</li>").join("") + "</ul><p>Continue anyway?</p>",
      { confirmLabel: "Continue" }
    ).then(ok => { if (ok) commit(); });
    return;
  }
  commit();
}
function deductInventoryForBatch(r, b) {
  if (!r) return;
  let deducted = 0;
  r.fermentables.forEach(f => { const item = state.inventory.fermentables.find(i => i.name.toLowerCase() === f.name.toLowerCase()); if (item) { item.stock -= Units.lbToUnit(f.amountLb, item.unit); deducted++; } });
  r.hops.forEach(h => { const item = state.inventory.hops.find(i => i.name.toLowerCase() === h.name.toLowerCase()); if (item) { item.stock -= Units.lbToUnit(h.amountOz / 16, item.unit); deducted++; } });
  const yeastItem = state.inventory.yeast.find(i => i.name.toLowerCase() === r.yeast.name.toLowerCase());
  if (yeastItem) { yeastItem.stock -= 1; deducted++; }
  if (b) b.inventoryDeducted = true;
  saveToStorage();
  toast(deducted ? "Deducted " + deducted + " item(s) from inventory" : "No matching inventory items found");
  renderMain();
}
function handleNewBatch() {
  const r = state.recipes.find(x => x.id === state.activeId) || state.recipes[0];
  const b = newBatch(r.id); state.batches.push(b); state.activeBatchId = b.id; saveToStorage(); renderAll(); toast("New batch started");
}
// Start a new, blank batch of the same recipe (BeerSmith 4's "New Session" idea, scoped down to
// this app's simpler model: batches already ARE the brew-log entries, so "rebrewing" is just
// starting a fresh one against the same recipe and switching to it - nothing about the old
// batch record changes).
function rebrewBatch(b) {
  const nb = newBatch(b.recipeId);
  state.batches.push(nb);
  state.activeBatchId = nb.id;
  saveToStorage(); renderAll();
  toast("Started a new batch of " + nb.recipeName);
}
// Lightweight inline SVG line chart of gravity (solid) and temperature (dashed) over the
// readings' dates. Deliberately simple - index-spaced x-axis (not true time-scale), min/max
// labels only - this is a brew-day glance, not a data-analysis tool.
function fermentationChartSvg(readings) {
  const sorted = [...readings].filter(fr => fr.gravity != null || fr.tempF != null).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (sorted.length < 2) return "";
  const W = 100, H = 34, padX = 3, padY = 4; // viewBox units - scales via CSS width
  const gravities = sorted.map(fr => fr.gravity).filter(v => v != null);
  const temps = sorted.map(fr => fr.tempF).filter(v => v != null);
  const gMin = gravities.length ? Math.min(...gravities) : 1, gMax = gravities.length ? Math.max(...gravities) : 1.06;
  const tMin = temps.length ? Math.min(...temps) : 60, tMax = temps.length ? Math.max(...temps) : 75;
  const gSpan = Math.max(0.001, gMax - gMin), tSpan = Math.max(1, tMax - tMin);
  const x = i => padX + (i / (sorted.length - 1)) * (W - padX * 2);
  const yG = v => H - padY - ((v - gMin) / gSpan) * (H - padY * 2);
  const yT = v => H - padY - ((v - tMin) / tSpan) * (H - padY * 2);
  const pathFor = (getVal, getY) => {
    let d = "", drawing = false;
    sorted.forEach((fr, i) => {
      const v = getVal(fr);
      if (v == null) { drawing = false; return; }
      d += (drawing ? "L" : "M") + x(i).toFixed(2) + "," + getY(v).toFixed(2) + " ";
      drawing = true;
    });
    return d.trim();
  };
  const gravityPath = gravities.length ? pathFor(fr => fr.gravity, yG) : "";
  const tempPath = temps.length ? pathFor(fr => fr.tempF, yT) : "";
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ferm-chart" preserveAspectRatio="none">' +
    (gravityPath ? '<path d="' + gravityPath + '" class="ferm-chart-gravity"/>' : "") +
    (tempPath ? '<path d="' + tempPath + '" class="ferm-chart-temp"/>' : "") +
    '</svg>' +
    '<div class="ferm-chart-legend"><span class="legend-gravity">\u2500 Gravity (' + gMin.toFixed(3) + '\u2013' + gMax.toFixed(3) + ')</span>' +
    (temps.length ? '<span class="legend-temp">- - Temp (' + uVal(tMin, "temp-f").toFixed(0) + '\u2013' + uVal(tMax, "temp-f").toFixed(0) + ' ' + uLabel("temp-f") + ')</span>' : "") + '</div>';
}
// Flexible CSV parser for Tilt hydrometer exports (Tilt Pi, or the Tilt Google Sheet template) -
// column names vary between export sources, so this matches by substring rather than an exact
// header, and simply skips any row it can't make sense of rather than failing the whole import.
function parseTiltCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
  const findCol = candidates => header.findIndex(h => candidates.some(c => h.includes(c)));
  const dateIdx = findCol(["timepoint", "timestamp", "date", "time"]);
  const tempIdx = findCol(["temp"]);
  const gravIdx = findCol(["sg", "gravity"]);
  const notesIdx = findCol(["comment", "note"]);
  if (dateIdx === -1 || (tempIdx === -1 && gravIdx === -1)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const rawDate = cols[dateIdx];
    const parsed = rawDate ? Date.parse(rawDate) : NaN;
    if (isNaN(parsed)) continue;
    const tempF = tempIdx !== -1 ? Number(cols[tempIdx]) : null;
    const gravity = gravIdx !== -1 ? Number(cols[gravIdx]) : null;
    if ((tempF == null || isNaN(tempF)) && (gravity == null || isNaN(gravity) || !gravity)) continue;
    out.push({
      id: uid(),
      date: new Date(parsed).toISOString().slice(0, 10),
      tempF: tempF != null && !isNaN(tempF) ? tempF : null,
      gravity: gravity != null && !isNaN(gravity) && gravity ? (gravity > 100 ? gravity / 1000 : gravity) : null, // some exports use "1050" instead of "1.050"
      notes: notesIdx !== -1 ? (cols[notesIdx] || "") : "",
    });
  }
  return out;
}

// ================= INVENTORY =================
const INVENTORY_KINDS = [["fermentables", "Fermentables"], ["hops", "Hops"], ["yeast", "Yeast"], ["misc", "Misc / Fining"]];
const CATALOGUE_KINDS = ["fermentables", "hops", "yeast", "misc"]; // kinds backed by data.js + region bulk-add
function renderInventoryMain(main) {
  const allShown = state.inventoryRegionFilter.length === 0;
  const filterChips = REGIONS.map(r => '<button class="btn btn-sm" data-region-chip="' + escapeHtml(r) + '" style="' + (state.inventoryRegionFilter.includes(r) ? "background:var(--amber);color:#fff;border-color:var(--amber);" : "") + '">' + escapeHtml(r) + '</button>').join("");
  main.innerHTML = '<div class="recipe-header"><h1 class="display page-title">Inventory</h1></div>' +
    '<p class="hint-text" style="margin:0 0 10px;"><strong>Every recipe\u2019s Fermentables/Hops/Yeast dropdown always lists your entire inventory, from every region \u2014 the filter below only changes what\u2019s shown on this page.</strong> Add an ingredient here and it shows up in every recipe; type a brand-new name into a recipe and it\u2019s added here. \u201c+ Add Region\u201d pulls in the built-in specs for a country\u2019s hops/malts/yeast (there\u2019s no live database behind this \u2014 see REFRESH_CATALOGUE.md).</p>' +
    '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:16px;">' +
    '<button class="btn btn-sm" data-region-chip="__all__" style="' + (allShown ? "background:var(--amber);color:#fff;border-color:var(--amber);" : "") + '">Show Everything</button>' +
    '<span class="hint-text">or just:</span>' + filterChips + '</div>' +
    INVENTORY_KINDS.map(pair => inventoryCardHtml(pair[0], pair[1])).join("");

  main.querySelectorAll("[data-region-chip]").forEach(btn => btn.addEventListener("click", (e) => {
    e.preventDefault();
    const val = btn.dataset.regionChip;
    if (val === "__all__") { state.inventoryRegionFilter = []; }
    else {
      const i = state.inventoryRegionFilter.indexOf(val);
      if (i === -1) state.inventoryRegionFilter.push(val); else state.inventoryRegionFilter.splice(i, 1);
    }
    saveToStorage(); renderMain();
  }));
  main.querySelectorAll("[data-add-kind]").forEach(btn => btn.addEventListener("click", () => { state.inventory[btn.dataset.addKind].push(newInventoryItem(btn.dataset.addKind)); saveToStorage(); renderMain(); }));
  main.querySelectorAll("[data-add-region-btn]").forEach(btn => btn.addEventListener("click", () => {
    const kind = btn.dataset.addRegionBtn;
    const region = main.querySelector('[data-region-select="' + kind + '"]').value;
    const added = addRegionToInventory(kind, region);
    // Adding a region you couldn't already see would otherwise look like nothing happened -
    // reveal it in the filter (unless everything's already shown) so the new items are visible immediately.
    if (state.inventoryRegionFilter.length > 0 && !state.inventoryRegionFilter.includes(region)) state.inventoryRegionFilter.push(region);
    saveToStorage(); renderMain();
    toast(added ? "Added " + added + " " + region + " item(s)" : "Already have everything from " + region);
  }));
  main.querySelectorAll("[data-add-all-btn]").forEach(btn => btn.addEventListener("click", () => {
    const kind = btn.dataset.addAllBtn;
    const added = addRegionToInventory(kind, "__all__");
    state.inventoryRegionFilter = []; // just pulled in everything - show everything, rather than hiding most of it immediately
    saveToStorage(); renderMain();
    toast(added ? "Added " + added + " item(s) from every region \u2014 filter reset to Show Everything" : "Already have the full catalogue");
  }));
  main.querySelectorAll("[data-ifield]").forEach(el => el.addEventListener("input", () => {
    const row = el.closest("[data-kind]"); const kind = row.dataset.kind, idx = Number(row.dataset.idx);
    let val = el.type === "number" ? Number(el.value) : el.value;
    if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
    const item = state.inventory[kind][idx];
    if (el.dataset.ifield === "attenuationPct") item.attenuation = val / 100;
    else item[el.dataset.ifield] = val;
    if (kind === "fermentables" && el.dataset.ifield === "type") item.mashable = ["Grain", "Adjunct"].includes(val);
    saveToStorage();
  }));
  main.querySelectorAll("[data-del-inv]").forEach(btn => btn.addEventListener("click", () => { const row = btn.closest("[data-kind]"); state.inventory[btn.dataset.delInv].splice(Number(row.dataset.idx), 1); saveToStorage(); renderMain(); }));
}

function inventoryCardHtml(kind, label) {
  const isCatalogueKind = CATALOGUE_KINDS.includes(kind);
  const filterActive = isCatalogueKind && state.inventoryRegionFilter.length > 0;
  const indexed = state.inventory[kind].map((item, i) => [item, i]);
  const visible = filterActive ? indexed.filter(pair => state.inventoryRegionFilter.includes(pair[0].origin || "Custom")) : indexed;
  const specHeaders = kind === "fermentables" ? "<th>Type</th><th>PPG</th><th>Colour (" + uLabel("color-srm") + ")</th>"
    : kind === "hops" ? "<th>Alpha %</th>"
    : kind === "yeast" ? "<th>Type</th><th>Attenuation %</th>"
    : "";
  const originHeader = isCatalogueKind ? "<th>Region</th>" : "";
  const colCount = 4 + (isCatalogueKind ? 1 : 0) + (kind === "fermentables" ? 3 : kind === "hops" ? 1 : kind === "yeast" ? 2 : 0);
  const emptyMsg = filterActive && state.inventory[kind].length
    ? "No items from " + state.inventoryRegionFilter.map(escapeHtml).join("/") + " \u2014 change the filter, or + Add Region"
    : "Nothing tracked yet" + (isCatalogueKind ? " \u2014 add a region below, or + Add Item" : "");
  const rows = visible.length ? visible.map(pair => inventoryRowHtml(kind, pair[0], pair[1])).join("")
    : '<tr class="empty-row"><td colspan="' + colCount + '">' + emptyMsg + '</td></tr>';
  const regionControls = isCatalogueKind
    ? '<select class="btn btn-sm" data-region-select="' + kind + '">' + REGIONS.filter(r => r !== "Custom").map(r => '<option ' + (r === state.region ? "selected" : "") + '>' + escapeHtml(r) + '</option>').join("") + '</select>' +
      '<button class="btn btn-sm" data-add-region-btn="' + kind + '">+ Add Region</button>' +
      '<button class="btn btn-sm" data-add-all-btn="' + kind + '">+ Add All Regions</button>'
    : "";
  const hiddenCount = state.inventory[kind].length - visible.length;
  const hiddenNote = hiddenCount > 0
    ? '<p class="hint-text" style="margin:6px 0 0;">' + hiddenCount + ' more item(s) hidden by the filter above \u2014 <a href="#" data-region-chip="__all__" style="color:var(--amber);">show everything</a>.</p>'
    : "";
  return '<div class="card"><h3>' + label + ' <span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;">' + regionControls + ' <button class="btn btn-sm" data-add-kind="' + kind + '">+ Add Item</button></span></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:22%">Name</th>' + originHeader + specHeaders + '<th>Stock</th><th>Unit</th><th>Cost / unit ($)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' + hiddenNote + '</div>';
}

function inventoryRowHtml(kind, item, i) {
  const unitOptions = ["kg", "g", "lb", "oz", "pkg", "tablet", "tsp", "ml", "item"];
  let specCells = "";
  if (kind === "fermentables") {
    specCells = '<td><select data-ifield="type">' + ["Grain", "Adjunct", "Sugar", "Extract"].map(t => '<option ' + (item.type === t ? "selected" : "") + '>' + t + '</option>').join("") + '</select></td>' +
      '<td><input type="number" step="0.5" data-ifield="ppg" value="' + item.ppg + '"/></td>' +
      '<td><input type="number" step="0.1" data-ifield="srm" data-unitkind="color-srm" value="' + uVal(item.srm, "color-srm") + '"/></td>';
  } else if (kind === "hops") {
    specCells = '<td><input type="number" step="0.1" data-ifield="alpha" value="' + item.alpha + '"/></td>';
  } else if (kind === "yeast") {
    specCells = '<td><select data-ifield="type">' + ["Ale", "Lager", "Ale Dry"].map(t => '<option ' + (item.type === t ? "selected" : "") + '>' + t + '</option>').join("") + '</select></td>' +
      '<td><input type="number" step="1" data-ifield="attenuationPct" value="' + (item.attenuation * 100).toFixed(0) + '"/></td>';
  }
  const originCell = CATALOGUE_KINDS.includes(kind) ? '<td style="color:var(--ink-faint);">' + escapeHtml(item.origin || "Custom") + '</td>' : "";
  return '<tr data-kind="' + kind + '" data-idx="' + i + '">' +
    '<td><input data-ifield="name" value="' + escapeHtml(item.name) + '"/></td>' +
    originCell + specCells +
    '<td><input type="number" step="0.1" data-ifield="stock" value="' + item.stock + '" style="' + (item.stock <= 0 ? "color:var(--alert);" : "") + '"/></td>' +
    '<td><select data-ifield="unit">' + unitOptions.map(u => '<option ' + (item.unit === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.01" data-ifield="cost" value="' + item.cost + '"/></td>' +
    '<td><button class="del-btn" data-del-inv="' + kind + '">\u2715</button></td></tr>';
}

// ================= EQUIPMENT =================
function renderEquipmentMain(main) {
  main.innerHTML = '<div class="recipe-header"><h1 class="display page-title">Equipment &amp; Packaging</h1></div>' +
    '<h2 class="section-heading">Brewing Equipment</h2>' +
    '<p class="hint-text">Mash tun / kettle specs for your system \u2014 link a profile to any recipe from its <strong>Design</strong> tab to drive batch-size, boil-off, trub loss, and efficiency calculations.</p>' +
    '<div class="header-actions" style="margin-bottom:14px;"><button class="btn btn-primary btn-sm" id="addEquipBtn">+ New Equipment Profile</button></div>' +
    (state.equipment.length ? state.equipment.map((e, i) =>
      '<div class="card" data-idx="' + i + '"><h3>' + escapeHtml(e.name) + ' <button class="btn btn-sm btn-danger" data-del-equip="' + i + '">Delete</button></h3><div class="field-grid">' +
      '<div class="field"><label>Name</label><input data-efield="name" value="' + escapeHtml(e.name) + '"/></div>' +
      '<div class="field"><label>Batch Size (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-efield="batchVolGal" data-unitkind="volume-gal" value="' + uVal(e.batchVolGal, "volume-gal") + '"/></div>' +
      '<div class="field"><label>Boil Time (min)</label><input type="number" step="1" data-efield="boilTimeMin" value="' + e.boilTimeMin + '"/></div>' +
      '<div class="field"><label>Boil-off Rate (' + uLabel("volume-gal") + '/hr)</label><input type="number" step="0.1" data-efield="boilOffRateGalHr" data-unitkind="volume-gal" value="' + uVal(e.boilOffRateGalHr, "volume-gal") + '"/></div>' +
      '<div class="field"><label>Trub/Chiller Loss (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-efield="trubLossGal" data-unitkind="volume-gal" value="' + uVal(e.trubLossGal, "volume-gal") + '"/></div>' +
      '<div class="field"><label>Mash Efficiency (%)</label><input type="number" step="1" data-efield="mashEfficiencyPct" value="' + e.mashEfficiencyPct + '"/></div>' +
      '</div></div>'
    ).join("") : '<div class="empty-state"><h2>No equipment profiles yet</h2><p>Add one to set default batch size, boil-off rate, and efficiency for your system \u2014 apply it to any recipe from the Design tab.</p></div>');
  document.getElementById("addEquipBtn").addEventListener("click", () => { state.equipment.push(newEquipment()); saveToStorage(); renderMain(); });
  main.querySelectorAll("[data-efield]").forEach(el => {
    const evt = el.dataset.efield === "name" ? "change" : "input"; // "change" (blur/Enter) - "input" would rebuild the whole page on every keystroke and drop focus, scrambling typed text
    el.addEventListener(evt, () => {
      const idx = Number(el.closest("[data-idx]").dataset.idx);
      let val = el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      state.equipment[idx][el.dataset.efield] = val; saveToStorage();
      if (el.dataset.efield === "name") renderMain();
    });
  });
  main.querySelectorAll("[data-del-equip]").forEach(btn => btn.addEventListener("click", () => { state.equipment.splice(Number(btn.dataset.delEquip), 1); saveToStorage(); renderMain(); }));

  // ---- Packaging / Vessel Sizes ----
  const packagingHtml = '<hr class="section-divider"/>' +
    '<h2 class="section-heading">Packaging &amp; Vessels</h2>' +
    '<p class="hint-text">Bottle/keg sizes \u2014 separate from Brewing Equipment above. Referenced by the Bottling/Kegging card on any <strong>Batch</strong>, so you can pick a vessel there instead of typing an approximate volume.</p>' +
    '<div class="card"><h3>Vessel Sizes <button class="btn btn-sm" id="addPackagingBtn">+ Add Vessel</button></h3>' +
    (state.packaging.length ? '<table class="ing-table"><thead><tr><th style="width:60%">Name</th><th>Volume (' + uLabel("volume-gal") + ')</th><th></th></tr></thead><tbody>' +
      state.packaging.map((p, i) =>
        '<tr data-pidx="' + i + '">' +
        '<td><input data-pfield="name" value="' + escapeHtml(p.name) + '"/></td>' +
        '<td><input type="number" step="0.01" data-pfield="volGal" data-unitkind="volume-gal" value="' + uVal(p.volGal, "volume-gal") + '"/></td>' +
        '<td><button class="del-btn" data-del-packaging="' + i + '">\u2715</button></td></tr>'
      ).join("") + '</tbody></table>' : '<p class="hint-text">No vessel sizes yet.</p>') +
    '</div>';
  main.insertAdjacentHTML("beforeend", packagingHtml);
  document.getElementById("addPackagingBtn").addEventListener("click", () => { state.packaging.push(newPackaging({ name: "New Vessel", volGal: 5 })); saveToStorage(); renderMain(); });
  main.querySelectorAll("[data-pfield]").forEach(el => {
    const evt = el.dataset.pfield === "name" ? "change" : "input"; // same focus-loss fix as Equipment's own name field
    el.addEventListener(evt, () => {
      const idx = Number(el.closest("[data-pidx]").dataset.pidx);
      let val = el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      state.packaging[idx][el.dataset.pfield] = val; saveToStorage();
      if (el.dataset.pfield === "name") renderMain();
    });
  });
  main.querySelectorAll("[data-del-packaging]").forEach(btn => btn.addEventListener("click", () => { state.packaging.splice(Number(btn.dataset.delPackaging), 1); saveToStorage(); renderMain(); }));
}

// ================= TOOLS =================
function renderToolsMain(main) {
  main.innerHTML =
    '<div class="recipe-header"><h1 class="display page-title">Quick Calculators</h1></div>' +
    '<div class="card"><h3>ABV from Readings</h3><div class="field-grid">' +
    '<div class="field"><label>Original Gravity</label><input type="number" step="0.001" id="calcOG" value="1.050"/></div>' +
    '<div class="field"><label>Final Gravity</label><input type="number" step="0.001" id="calcFG" value="1.010"/></div>' +
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label">Alcohol by Volume</span><span class="stat-value" id="calcABVOut">5.25%</span></div></div>' +
    '<div class="card"><h3>Priming Sugar (bottle carbonation)</h3><div class="field-grid">' +
    '<div class="field"><label>Batch Size (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" id="calcPrimeVol" value="' + uVal(5, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Beer Temp (' + uLabel("temp-f") + ')</label><input type="number" step="1" id="calcPrimeTemp" value="' + uVal(68, "temp-f") + '"/></div>' +
    '<div class="field"><label>Target Volumes CO2</label><input type="number" step="0.1" id="calcPrimeTarget" value="2.4"/></div>' +
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label">Corn Sugar (Dextrose) Needed</span><span class="stat-value" id="calcPrimeOut">\u2014</span></div></div>' +
    '<div class="card"><h3>Hydrometer Temperature Correction</h3><div class="field-grid">' +
    '<div class="field"><label>Measured Gravity</label><input type="number" step="0.001" id="calcHydroSG" value="1.050"/></div>' +
    '<div class="field"><label>Sample Temp (' + uLabel("temp-f") + ')</label><input type="number" step="1" id="calcHydroTemp" value="' + uVal(95, "temp-f") + '"/></div>' +
    '<div class="field"><label>Calibration Temp (' + uLabel("temp-f") + ')</label><input type="number" step="1" id="calcHydroCal" value="' + uVal(60, "temp-f") + '"/></div>' +
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label">Corrected Gravity</span><span class="stat-value" id="calcHydroOut">\u2014</span></div></div>' +
    '<div class="card"><h3>Keg Carbonation Pressure</h3><div class="field-grid">' +
    '<div class="field"><label>Beer Temp (' + uLabel("temp-f") + ')</label><input type="number" step="1" id="calcKegTemp" value="' + uVal(38, "temp-f") + '"/></div>' +
    '<div class="field"><label>Target Volumes CO2</label><input type="number" step="0.1" id="calcKegTarget" value="2.4"/></div>' +
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label">Set Regulator To</span><span class="stat-value" id="calcKegOut">\u2014</span></div></div>' +
    '<div class="card"><h3>Refractometer Correction</h3><p class="hint-text" style="margin:-4px 0 10px;">Once alcohol is present, a refractometer over-reads \u2014 use this to find the true gravity from Brix.</p><div class="field-grid">' +
    '<div class="field"><label>Original Brix (\u00b0Bx)</label><input type="number" step="0.1" id="calcRefriOB" value="12.4"/></div>' +
    '<div class="field"><label>Current Brix (\u00b0Bx)</label><input type="number" step="0.1" id="calcRefriFB" value="6.5"/></div>' +
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label">Corrected Gravity</span><span class="stat-value" id="calcRefriOut">\u2014</span></div></div>' +
    '<div class="card"><h3>Boil-off / Dilution</h3><p class="hint-text" style="margin:-4px 0 10px;">Figure out how much to boil off (concentrate) or top up with water (dilute) to hit a target gravity.</p><div class="field-grid">' +
    '<div class="field"><label>Current Volume (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" id="calcDilVol" value="' + uVal(6, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Current Gravity</label><input type="number" step="0.001" id="calcDilCurSG" value="1.040"/></div>' +
    '<div class="field"><label>Target Gravity</label><input type="number" step="0.001" id="calcDilTargetSG" value="1.050"/></div>' +
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label" id="calcDilLabel">Boil Off</span><span class="stat-value" id="calcDilOut">\u2014</span></div></div>' +
    '<div class="card"><h3>Yeast Pitch Rate</h3><p class="hint-text" style="margin:-4px 0 10px;">Rough guide only, not an exact growth model \u2014 a fresh liquid pack is typically ~100 billion cells; dry yeast packs are usually already enough for most standard-gravity ale batches.</p><div class="field-grid">' +
    '<div class="field"><label>Original Gravity</label><input type="number" step="0.001" id="calcPitchOG" value="1.050"/></div>' +
    '<div class="field"><label>Batch Size (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" id="calcPitchVol" value="' + uVal(5, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Style</label><select id="calcPitchStyle"><option>Ale</option><option>Lager</option></select></div>' +
    '<div class="field"><label>Liquid Pack Age (days)</label><input type="number" step="1" id="calcPitchAge" value="0"/></div>' +
    '</div><div class="stat-row"><span class="stat-label">Cells Needed</span><span class="stat-value" id="calcPitchNeed">\u2014</span></div>' +
    '<div class="stat-row"><span class="stat-label">One Fresh Liquid Pack (adjusted for age)</span><span class="stat-value" id="calcPitchAvail">\u2014</span></div>' +
    '<div class="stat-row"><span class="stat-label" id="calcPitchVerdictLabel">Verdict</span><span class="stat-value" id="calcPitchVerdict">\u2014</span></div>' +
    '<p class="hint-text" style="margin:10px 0 0;">If underpitched: a stir-plate starter roughly adds 1.5\u20132x cell count per step, or simply pitch two packs.</p></div>' +
    '<div class="card"><h3>Unit Converter</h3><div class="field-grid">' +
    '<div class="field"><label>Weight</label><input type="number" step="0.01" id="calcConvWeight" value="1"/></div>' +
    '<div class="field"><label>&nbsp;</label><select id="calcConvWeightUnit"><option value="kg">kg</option><option value="lb">lb</option><option value="oz">oz</option><option value="g">g</option></select></div>' +
    '</div><div class="stat-row"><span class="stat-label" id="calcConvWeightLabel">=</span><span class="stat-value" id="calcConvWeightOut">\u2014</span></div>' +
    '<div class="field-grid" style="margin-top:10px;">' +
    '<div class="field"><label>Volume</label><input type="number" step="0.01" id="calcConvVol" value="5"/></div>' +
    '<div class="field"><label>&nbsp;</label><select id="calcConvVolUnit"><option value="gal">gal (US)</option><option value="l">L</option><option value="qt">qt</option><option value="floz">fl oz</option></select></div>' +
    '</div><div class="stat-row"><span class="stat-label" id="calcConvVolLabel">=</span><span class="stat-value" id="calcConvVolOut">\u2014</span></div>' +
    '<div class="field-grid" style="margin-top:10px;">' +
    '<div class="field"><label>Temperature</label><input type="number" step="0.1" id="calcConvTemp" value="68"/></div>' +
    '<div class="field"><label>&nbsp;</label><select id="calcConvTempUnit"><option value="f">\u00b0F</option><option value="c">\u00b0C</option></select></div>' +
    '</div><div class="stat-row"><span class="stat-label" id="calcConvTempLabel">=</span><span class="stat-value" id="calcConvTempOut">\u2014</span></div>' +
    '<div class="field-grid" style="margin-top:10px;">' +
    '<div class="field"><label>Gravity</label><input type="number" step="0.001" id="calcConvSG" value="1.050"/></div>' +
    '</div><div class="stat-row"><span class="stat-label">= \u00b0Plato / \u00b0Brix</span><span class="stat-value" id="calcConvPlatoOut">\u2014</span></div>' +
    '</div>';

  const abvOut = document.getElementById("calcABVOut");
  const updateABV = () => { const og = Number(document.getElementById("calcOG").value), fg = Number(document.getElementById("calcFG").value); abvOut.textContent = Calc.estimateABV(og, fg).toFixed(2) + "%"; };
  document.getElementById("calcOG").addEventListener("input", updateABV); document.getElementById("calcFG").addEventListener("input", updateABV); updateABV();

  const primeOut = document.getElementById("calcPrimeOut");
  const updatePrime = () => {
    const volGal = Units.toCanonical(Number(document.getElementById("calcPrimeVol").value), "volume-gal", state.unitSystem);
    const tempF = Units.toCanonical(Number(document.getElementById("calcPrimeTemp").value), "temp-f", state.unitSystem);
    const target = Number(document.getElementById("calcPrimeTarget").value);
    const grams = Calc.primingSugarGrams(volGal, tempF, target);
    primeOut.textContent = grams.toFixed(0) + " g (" + (grams / 28.3495).toFixed(2) + " oz)";
  };
  ["calcPrimeVol", "calcPrimeTemp", "calcPrimeTarget"].forEach(id => document.getElementById(id).addEventListener("input", updatePrime)); updatePrime();

  const hydroOut = document.getElementById("calcHydroOut");
  const updateHydro = () => {
    const sg = Number(document.getElementById("calcHydroSG").value);
    const t = Units.toCanonical(Number(document.getElementById("calcHydroTemp").value), "temp-f", state.unitSystem);
    const c = Units.toCanonical(Number(document.getElementById("calcHydroCal").value), "temp-f", state.unitSystem);
    const poly = T => 1.00130346 - 0.000134722124 * T + 0.00000204052596 * T * T - 0.0000000023282098 * T * T * T;
    hydroOut.textContent = (sg * (poly(t) / poly(c))).toFixed(4);
  };
  ["calcHydroSG", "calcHydroTemp", "calcHydroCal"].forEach(id => document.getElementById(id).addEventListener("input", updateHydro)); updateHydro();

  const kegOut = document.getElementById("calcKegOut");
  const updateKeg = () => {
    const tempF = Units.toCanonical(Number(document.getElementById("calcKegTemp").value), "temp-f", state.unitSystem);
    const target = Number(document.getElementById("calcKegTarget").value);
    kegOut.textContent = Calc.kegCarbPSI(tempF, target).toFixed(1) + " PSI";
  };
  ["calcKegTemp", "calcKegTarget"].forEach(id => document.getElementById(id).addEventListener("input", updateKeg)); updateKeg();

  const refriOut = document.getElementById("calcRefriOut");
  const updateRefri = () => {
    const ob = Number(document.getElementById("calcRefriOB").value);
    const fb = Number(document.getElementById("calcRefriFB").value);
    refriOut.textContent = Calc.correctedGravityFromBrix(ob, fb).toFixed(3);
  };
  ["calcRefriOB", "calcRefriFB"].forEach(id => document.getElementById(id).addEventListener("input", updateRefri)); updateRefri();

  const dilOut = document.getElementById("calcDilOut"), dilLabel = document.getElementById("calcDilLabel");
  const updateDil = () => {
    const volGal = Units.toCanonical(Number(document.getElementById("calcDilVol").value), "volume-gal", state.unitSystem);
    const curSG = Number(document.getElementById("calcDilCurSG").value);
    const targetSG = Number(document.getElementById("calcDilTargetSG").value);
    const result = Calc.dilutionTargetVol(volGal, curSG, targetSG);
    if (!result) { dilOut.textContent = "\u2014"; return; }
    const boilOff = result.boilOffGal >= 0;
    dilLabel.textContent = boilOff ? "Boil Off" : "Add Water";
    dilOut.textContent = uVal(Math.abs(result.boilOffGal), "volume-gal").toFixed(2) + " " + uLabel("volume-gal") + " (to " + uVal(result.targetVolGal, "volume-gal").toFixed(2) + " " + uLabel("volume-gal") + " total)";
  };
  ["calcDilVol", "calcDilCurSG", "calcDilTargetSG"].forEach(id => document.getElementById(id).addEventListener("input", updateDil)); updateDil();

  const pitchNeed = document.getElementById("calcPitchNeed"), pitchAvail = document.getElementById("calcPitchAvail"), pitchVerdict = document.getElementById("calcPitchVerdict");
  const updatePitch = () => {
    const og = Number(document.getElementById("calcPitchOG").value);
    const volGal = Units.toCanonical(Number(document.getElementById("calcPitchVol").value), "volume-gal", state.unitSystem);
    const style = document.getElementById("calcPitchStyle").value;
    const ageDays = Number(document.getElementById("calcPitchAge").value);
    const needed = Calc.pitchRateCellsNeededBillion(og, volGal, style);
    const avail = Calc.viableCellsBillion(100, ageDays);
    pitchNeed.textContent = needed.toFixed(0) + " billion cells";
    pitchAvail.textContent = avail.toFixed(0) + " billion cells";
    const ratio = avail / needed;
    pitchVerdict.textContent = ratio >= 1 ? "Plenty \u2014 no starter needed" : ratio >= 0.6 ? "A bit short \u2014 a starter would help" : "Underpitched \u2014 use a starter or pitch 2 packs";
    pitchVerdict.style.color = ratio >= 1 ? "var(--ink)" : ratio >= 0.6 ? "var(--amber)" : "var(--alert)";
  };
  ["calcPitchOG", "calcPitchVol", "calcPitchStyle", "calcPitchAge"].forEach(id => document.getElementById(id).addEventListener("input", updatePitch)); updatePitch();

  // ---- Unit converter ----
  const weightToKg = { kg: 1, lb: 0.45359237, oz: 0.028349523125, g: 0.001 };
  const updateConvWeight = () => {
    const val = Number(document.getElementById("calcConvWeight").value);
    const unit = document.getElementById("calcConvWeightUnit").value;
    const kg = val * weightToKg[unit];
    document.getElementById("calcConvWeightLabel").textContent = val + " " + unit + " =";
    document.getElementById("calcConvWeightOut").textContent = (kg / weightToKg.kg).toFixed(3) + " kg \u00b7 " + (kg / weightToKg.lb).toFixed(3) + " lb \u00b7 " + (kg / weightToKg.oz).toFixed(2) + " oz \u00b7 " + (kg / weightToKg.g).toFixed(1) + " g";
  };
  ["calcConvWeight", "calcConvWeightUnit"].forEach(id => document.getElementById(id).addEventListener("input", updateConvWeight)); updateConvWeight();

  const volToL = { gal: 3.785411784, l: 1, qt: 0.946352946, floz: 0.0295735296 };
  const updateConvVol = () => {
    const val = Number(document.getElementById("calcConvVol").value);
    const unit = document.getElementById("calcConvVolUnit").value;
    const l = val * volToL[unit];
    document.getElementById("calcConvVolLabel").textContent = val + " " + unit + " =";
    document.getElementById("calcConvVolOut").textContent = (l / volToL.gal).toFixed(3) + " gal \u00b7 " + (l / volToL.l).toFixed(3) + " L \u00b7 " + (l / volToL.qt).toFixed(2) + " qt \u00b7 " + (l / volToL.floz).toFixed(1) + " fl oz";
  };
  ["calcConvVol", "calcConvVolUnit"].forEach(id => document.getElementById(id).addEventListener("input", updateConvVol)); updateConvVol();

  const updateConvTemp = () => {
    const val = Number(document.getElementById("calcConvTemp").value);
    const unit = document.getElementById("calcConvTempUnit").value;
    const f = unit === "c" ? (val * 9 / 5) + 32 : val;
    const c = unit === "f" ? (val - 32) * 5 / 9 : val;
    document.getElementById("calcConvTempLabel").textContent = val + "\u00b0" + unit.toUpperCase() + " =";
    document.getElementById("calcConvTempOut").textContent = f.toFixed(1) + "\u00b0F \u00b7 " + c.toFixed(1) + "\u00b0C";
  };
  ["calcConvTemp", "calcConvTempUnit"].forEach(id => document.getElementById(id).addEventListener("input", updateConvTemp)); updateConvTemp();

  const updateConvPlato = () => {
    const sg = Number(document.getElementById("calcConvSG").value);
    document.getElementById("calcConvPlatoOut").textContent = Calc.sgToPlato(sg).toFixed(1) + " \u00b0P/Bx";
  };
  document.getElementById("calcConvSG").addEventListener("input", updateConvPlato); updateConvPlato();
}

// ---- Init ----
function seedDefaults() {
  state.tree = Tree.createRoot();
  if (!state.equipment.length) state.equipment = EQUIPMENT_PRESETS.map(p => newEquipment(p));
  if (!state.packaging.length) state.packaging = PACKAGING_PRESETS.map(p => newPackaging(p));
  if (!state.recipes.length) { const r = newRecipe(); state.recipes.push(r); state.activeId = r.id; state.tree.children.push(Tree.createLeaf(r.id)); }
}

function init() {
  const had = loadFromStorage();
  if (!had) seedDefaults();
  if (!state.tree) { state.tree = Tree.createRoot(); state.recipes.forEach(r => state.tree.children.push(Tree.createLeaf(r.id))); }
  if (!state.equipment) state.equipment = [];
  if (!state.packaging) state.packaging = [];
  if (!state.batches) state.batches = [];
  if (!state.inventory) state.inventory = { fermentables: [], hops: [], yeast: [], misc: [] };
  if (!state.customIngredients) state.customIngredients = { fermentables: [], hops: [], yeast: [] };
  if (!state.unitSystem) state.unitSystem = "metric";
  if (!state.region) state.region = "New Zealand";
  if (!Array.isArray(state.inventoryRegionFilter)) state.inventoryRegionFilter = ["New Zealand", "Australia", "Custom"];
  state.recipes.forEach(migrateRecipe);
  state.batches.forEach(migrateBatch);
  migrateInventoryModel();
  fixCustomRegionVisibility();
  state.equipment.forEach(e => { if (e.tempAdjustF == null) e.tempAdjustF = 2; });
  Tree.pruneOrphans(state.tree, new Set(state.recipes.map(r => r.id)));
  saveToStorage();
  renderAll();
  updateUnitToggleLabel();
  renderRegionSelect();
  renderFileWorkspaceControls();
  checkIncomingShare();

  document.getElementById("newRecipeBtn").addEventListener("click", () => { if (state.activeSection === "recipes") handleNewRecipe(); else if (state.activeSection === "batches") handleNewBatch(); });
  document.getElementById("newFolderBtn").addEventListener("click", () => { state.tree.children.push(Tree.createFolder(uniqueSiblingName(state.tree, "folder", "New Folder"))); saveToStorage(); renderSidebar(); });
  document.getElementById("exportAllBtn").addEventListener("click", exportAll);
  document.getElementById("importInput").addEventListener("change", e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; });
  document.getElementById("unitToggleBtn").addEventListener("click", () => { state.unitSystem = state.unitSystem === "metric" ? "us" : "metric"; saveToStorage(); updateUnitToggleLabel(); renderAll(); });
  document.getElementById("regionSelect").addEventListener("change", e => { state.region = e.target.value; saveToStorage(); renderAll(); });

  // Mobile hamburger drawer
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (sidebarToggle) sidebarToggle.addEventListener("click", () => { sidebar.classList.add("open"); backdrop.classList.add("open"); });
  if (backdrop) backdrop.addEventListener("click", () => { sidebar.classList.remove("open"); backdrop.classList.remove("open"); });
  document.getElementById("recipeList").addEventListener("click", () => {
    if (window.innerWidth <= 860) { sidebar.classList.remove("open"); backdrop.classList.remove("open"); }
  });
}
function updateUnitToggleLabel() { document.getElementById("unitToggleBtn").textContent = state.unitSystem === "metric" ? "Units: Metric" : "Units: Imperial"; }
function renderRegionSelect() {
  const el = document.getElementById("regionSelect");
  el.innerHTML = REGIONS.map(reg => '<option value="' + escapeHtml(reg) + '" ' + (state.region === reg ? "selected" : "") + '>' + escapeHtml(reg) + ' hops/malts/yeast first</option>').join("");
}

// ---- Working file (File System Access API) ----
function renderFileWorkspaceControls() {
  const el = document.getElementById("fileWorkspaceControls");
  if (!el) return;
  if (!FileWorkspace.supported) {
    el.innerHTML = '<p class="hint-text" style="margin:0 0 8px;">Local file linking needs Chrome or Edge \u2014 use Export/Import below on this browser instead.</p>';
    return;
  }
  el.innerHTML =
    '<div style="display:flex; gap:8px; margin-bottom:6px;">' +
    '<button class="btn btn-sm" id="openFileBtn" style="flex:1;">Open File\u2026</button>' +
    '<button class="btn btn-sm btn-primary" id="saveFileBtn" style="flex:1;">' + (FileWorkspace.linkedName ? "Save" : "Save As\u2026") + '</button>' +
    '</div>' +
    '<p class="hint-text" style="margin:0 0 10px;">' +
    (FileWorkspace.linkedName
      ? 'Linked to <strong style="color:var(--ink-dim);">' + escapeHtml(FileWorkspace.linkedName) + '</strong> \u2014 Save writes straight back to it. <a href="#" id="unlinkFileBtn" style="color:var(--amber);">Unlink</a>'
      : "No file linked yet \u2014 Save will ask where to create one, then remembers it for next time.") +
    '</p>';
  document.getElementById("openFileBtn").addEventListener("click", handleOpenWorkingFile);
  document.getElementById("saveFileBtn").addEventListener("click", handleSaveWorkingFile);
  const unlinkBtn = document.getElementById("unlinkFileBtn");
  if (unlinkBtn) unlinkBtn.addEventListener("click", e => { e.preventDefault(); FileWorkspace.unlink(); renderFileWorkspaceControls(); toast("Unlinked \u2014 Save will ask for a new location"); });
}

async function handleOpenWorkingFile() {
  try {
    const data = await FileWorkspace.openFile();
    if (!data || !Array.isArray(data.recipes)) { toast("That file doesn't look like a Hops backup"); FileWorkspace.unlink(); return; }
    if (state.recipes.length) {
      const ok = await showConfirmModal("Open File?", 'Open "' + escapeHtml(FileWorkspace.linkedName) + '"? This replaces everything currently shown in Hops (including this browser\'s own autosave) with the file\'s contents.', { confirmLabel: "Open", danger: true });
      if (!ok) { FileWorkspace.unlink(); return; }
    }
    const restored = Security.sanitizeDeep(data);
    (restored.recipes || []).forEach(migrateRecipe);
    (restored.batches || []).forEach(migrateBatch);
    if (!restored.tree) { restored.tree = Tree.createRoot(); (restored.recipes || []).forEach(r => restored.tree.children.push(Tree.createLeaf(r.id))); }
    Tree.pruneOrphans(restored.tree, new Set((restored.recipes || []).map(r => r.id)));
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, restored, { activeSection: "recipes", activeId: (restored.recipes && restored.recipes[0]) ? restored.recipes[0].id : null, activeTab: "design", activeBatchId: null });
    if (!state.equipment) state.equipment = [];
    if (!state.packaging) state.packaging = PACKAGING_PRESETS.map(p => newPackaging(p));
    if (!state.batches) state.batches = [];
    if (!state.inventory) state.inventory = { fermentables: [], hops: [], yeast: [], misc: [] };
    if (!state.customIngredients) state.customIngredients = { fermentables: [], hops: [], yeast: [] };
    if (!state.unitSystem) state.unitSystem = "metric";
    if (!state.region) state.region = "New Zealand";
    if (!Array.isArray(state.inventoryRegionFilter)) state.inventoryRegionFilter = ["New Zealand", "Australia", "Custom"];
    migrateInventoryModel();
    fixCustomRegionVisibility();
    saveToStorage(); renderAll(); renderFileWorkspaceControls(); updateUnitToggleLabel();
    toast("Opened " + FileWorkspace.linkedName);
  } catch (e) {
    if (e.name === "AbortError") return; // user cancelled the picker
    toast("Could not open file: " + e.message);
  }
}

async function handleSaveWorkingFile() {
  try {
    const name = FileWorkspace.fileHandle ? await FileWorkspace.saveToLinkedFile(state) : await FileWorkspace.saveAsNewFile(state);
    renderFileWorkspaceControls();
    toast("Saved to " + name);
  } catch (e) {
    if (e.name === "AbortError") return;
    toast("Could not save file: " + e.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
