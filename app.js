// ---- Hops app: state, rendering, events ----
const escapeHtml = s => Security.escapeHtml(s);
const STORAGE_KEY = "hops.state.v1";

let state = {
  recipes: [],
  tree: null,
  batches: [],
  equipment: [],
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

// Groups an ingredient library (state.inventory.fermentables/hops/yeast) into <optgroup>s by
// region (state.region) shown first, then the rest of the known regions, then anything uncategorised.
function regionGroupedOptions(library, currentName, known) {
  const groups = new Map();
  library.forEach(x => {
    const g = x.origin || "Custom";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  });
  const order = [state.region].concat(REGIONS.filter(r => r !== state.region)).concat(["Custom"]);
  let html = "";
  order.forEach(g => {
    const items = groups.get(g);
    if (!items || !items.length) return;
    html += '<optgroup label="' + escapeHtml(g) + '">' + items.map(x => '<option value="' + escapeHtml(x.name) + '" ' + (known && x.name === currentName ? "selected" : "") + '>' + escapeHtml(x.name) + '</option>').join("") + '</optgroup>';
    groups.delete(g);
  });
  groups.forEach((items, g) => { html += '<optgroup label="' + escapeHtml(g) + '">' + items.map(x => '<option value="' + escapeHtml(x.name) + '" ' + (known && x.name === currentName ? "selected" : "") + '>' + escapeHtml(x.name) + '</option>').join("") + '</optgroup>'; });
  return html;
}

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
function newBatch(recipeId) {
  const r = state.recipes.find(x => x.id === recipeId);
  return { id: uid(), recipeId, recipeName: r ? r.name : "Unknown Recipe", status: "Planning", brewDate: new Date().toISOString().slice(0, 10), measuredOG: null, measuredFG: null, notes: "" };
}
// Adds every catalogue entry for `kind` matching `region` (or every entry, if region === "__all__")
// into the inventory list, skipping names already present. Returns how many were added.
function addRegionToInventory(kind, region) {
  const catalogue = { fermentables: FERMENTABLES, hops: HOPS, yeast: YEASTS }[kind];
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
    state.catalogueSeeded = true;
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
  (r.waterSalts || []).forEach(s => { if (!s.use) s.use = "Mash"; });
  (r.hops || []).forEach(h => { if (h.whirlpoolTempF == null) h.whirlpoolTempF = 194; });
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
function showModal(innerHtml, onMount) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modalOverlay";
  overlay.innerHTML = '<div class="modal-box">' + innerHtml + '</div>';
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  if (onMount) onMount(overlay);
}
function closeModal() { const el = document.getElementById("modalOverlay"); if (el) el.remove(); }

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
    '<p style="font-size:13px;color:var(--ink-dim);">via ' + escapeHtml(sourceLabel) + '. ' +
    (matchCount ? matchCount + " match" + (matchCount > 1 ? "" : "es") + " a recipe you already have; " : "") +
    (recipes.length - matchCount) + " new.</p>" +
    '<ul style="font-size:12px;color:var(--ink-faint);max-height:160px;overflow-y:auto;margin:10px 0;padding-left:18px;">' +
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
    '<p style="font-size:13px;color:var(--ink-dim);">' + rCount + " recipe(s), " + bCount + " batch(es), " + eCount + " equipment profile(s).</p>" +
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
      overlay.querySelector("#replaceAllBtn").addEventListener("click", () => {
        if (!confirm("This replaces every recipe, batch, folder, inventory item, and equipment profile currently stored in this browser with the contents of the backup file. This can't be undone. Continue?")) return;
        const restored = Security.sanitizeDeep(parsed);
        (restored.recipes || []).forEach(migrateRecipe);
        if (!restored.tree) { restored.tree = Tree.createRoot(); (restored.recipes || []).forEach(r => restored.tree.children.push(Tree.createLeaf(r.id))); }
        Tree.pruneOrphans(restored.tree, new Set((restored.recipes || []).map(r => r.id)));
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, restored, { activeSection: "recipes", activeId: (restored.recipes && restored.recipes[0]) ? restored.recipes[0].id : null, activeTab: "design", activeBatchId: null });
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
function scaleRecipe(r) {
  const label = Units.unitLabel("volume-gal", state.unitSystem);
  const currentDisplay = Units.toDisplay(r.batchVolGal, "volume-gal", state.unitSystem).toFixed(2);
  const input = window.prompt('Scale "' + r.name + '" to a new batch size (' + label + '):', currentDisplay);
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
    '<p style="color:var(--ink-faint);font-size:13px;">' + description + '</p>' +
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
    showModal(shareModalHtml('Share Batch: "' + escapeHtml(b.recipeName) + '"',
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
    (d ? '<p style="color:var(--ink-faint);font-size:13px;">OG ' + d.og.toFixed(3) + ' \u00b7 ' + d.abv.toFixed(1) + '% ABV \u00b7 ' + Math.round(d.ibu) + ' IBU</p>' : "") +
    (existing ? '<p style="color:var(--amber);font-size:13px;">You already have a recipe with this ID: "' + escapeHtml(existing.name) + '".</p>' : "") +
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
  const incomingBatch = data.batch;
  const incomingRecipe = data.recipe ? migrateRecipe(data.recipe) : null;
  const existingBatch = state.batches.find(x => x.id === incomingBatch.id);
  const haveRecipe = state.recipes.some(x => x.id === incomingBatch.recipeId);
  showModal(
    '<h3>Shared Batch</h3>' +
    '<p><strong>' + escapeHtml(incomingBatch.recipeName) + '</strong> \u2014 ' + escapeHtml(incomingBatch.status) + ' \u00b7 ' + nzDate(incomingBatch.brewDate) + '</p>' +
    (incomingBatch.notes ? '<p style="color:var(--ink-faint);font-size:13px;">"' + escapeHtml(incomingBatch.notes.slice(0, 140)) + (incomingBatch.notes.length > 140 ? "\u2026" : "") + '"</p>' : "") +
    (!haveRecipe && incomingRecipe ? '<p style="color:var(--ink-faint);font-size:12px;">Its recipe ("' + escapeHtml(incomingRecipe.name) + '") will be added too, since you don\u2019t have it yet.</p>' : "") +
    (existingBatch ? '<p style="color:var(--amber);font-size:13px;">You already have a batch with this ID.</p>' : "") +
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
      '<div class="name">' + escapeHtml(b.recipeName) + '</div>' +
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
    items.push({ label: "Rename Folder", action: () => {
      const name = window.prompt("Folder name:", node.name);
      if (name) {
        const parentNode = Tree.findParent(state.tree, node.id) || state.tree;
        Tree.renameNode(state.tree, node.id, uniqueSiblingName(parentNode, "folder", name, node.id));
        saveToStorage(); renderSidebar();
      }
    }});
    items.push({ label: "Edit Notes", action: () => { const notes = window.prompt("Folder notes:", node.notes || ""); if (notes !== null) { node.notes = notes; saveToStorage(); } } });
    if (node.id !== "root") {
      items.push({ divider: true });
      items.push({ label: "Delete Folder & Contents", danger: true, action: () => {
        const count = Tree.countRecipes(node);
        if (!confirm('Delete "' + node.name + '"' + (count ? " and its " + count + " recipe(s)" : "") + "? This can't be undone.")) return;
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
      items.push({ label: "Rename", action: () => {
        const name = window.prompt("Recipe name:", r.name);
        if (name) {
          const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
          const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
          r.name = uniqueSiblingName(parentNode, "recipe", name, leaf ? leaf.id : undefined);
          saveToStorage(); renderAll();
        }
      }});
      items.push({ label: "Share Link", action: () => shareRecipe(r) });
      items.push({ divider: true });
      items.push({ label: "Delete", danger: true, action: () => {
        if (!confirm('Delete "' + r.name + '"? This can\'t be undone.')) return;
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
  document.getElementById("deleteBtn").addEventListener("click", () => {
    if (!confirm('Delete "' + r.name + '"? This can\'t be undone.')) return;
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
  const fermLibrary = state.inventory.fermentables;
  const hopLibrary = state.inventory.hops;
  const yeastLibrary = state.inventory.yeast;
  function buildIngredientSelect(library, currentName) {
    const known = library.some(x => x.name === currentName);
    let opts = "";
    if (!known && currentName) opts += '<option value="' + escapeHtml(currentName) + '" selected>' + escapeHtml(currentName) + ' (custom)</option>';
    opts += '<option value="__custom__">\u2014 Custom Name\u2026 \u2014</option>';
    opts += regionGroupedOptions(library, currentName, known);
    return opts;
  }
  const equipOptions = state.equipment.map(e => '<option value="' + e.id + '" ' + (r.equipmentId === e.id ? "selected" : "") + '>' + escapeHtml(e.name) + '</option>').join("");
  const styleOptions = STYLES.map(s => '<option ' + (r.styleName === s.name ? "selected" : "") + '>' + s.name + '</option>').join("");

  const fermRows = r.fermentables.length ? r.fermentables.map((f, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><select data-tbl="fermentables" data-field="name">' + buildIngredientSelect(fermLibrary, f.name) + '</select></td>' +
    '<td><input type="number" step="0.1" data-tbl="fermentables" data-field="amountLb" data-unitkind="weight-lb" value="' + uVal(f.amountLb, "weight-lb") + '"/></td>' +
    '<td><select data-tbl="fermentables" data-field="type">' + ["Grain", "Adjunct", "Sugar", "Extract"].map(t => '<option ' + (f.type === t ? "selected" : "") + '>' + t + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.5" data-tbl="fermentables" data-field="ppg" value="' + f.ppg + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="fermentables" data-field="color" data-unitkind="color-srm" value="' + uVal(f.color, "color-srm") + '"/></td>' +
    '<td class="num grist-pct">' + (d.grainPercents[i] || 0).toFixed(1) + '%</td>' +
    '<td><input type="number" step="0.01" data-tbl="fermentables" data-field="cost" value="' + (f.cost || 0) + '"/></td>' +
    '<td class="row-actions"><button class="btn btn-sm" data-substitute="fermentables">Sub</button><button class="btn btn-sm" data-save-item="fermentables">Save</button><button class="del-btn" data-del="fermentables">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="8">No fermentables yet</td></tr>';

  const hopRows = r.hops.length ? r.hops.map((h, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><select data-tbl="hops" data-field="name">' + buildIngredientSelect(hopLibrary, h.name) + '</select></td>' +
    '<td><input type="number" step="0.1" data-tbl="hops" data-field="amountOz" data-unitkind="weight-oz" value="' + uVal(h.amountOz, "weight-oz") + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="hops" data-field="alphaPct" value="' + h.alphaPct + '"/></td>' +
    '<td><input type="number" step="1" data-tbl="hops" data-field="timeMin" value="' + h.timeMin + '"/></td>' +
    '<td><select data-tbl="hops" data-field="use">' + ["Boil", "Whirlpool", "Dry Hop"].map(u => '<option ' + (h.use === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td>' + (h.use === "Whirlpool" ? '<input type="number" step="1" data-tbl="hops" data-field="whirlpoolTempF" data-unitkind="temp-f" value="' + uVal(h.whirlpoolTempF != null ? h.whirlpoolTempF : 194, "temp-f") + '" title="Whirlpool/stand temperature - the single biggest factor in how much IBU a whirlpool addition contributes"/>' : '<span style="color:var(--ink-faint);">\u2014</span>') + '</td>' +
    '<td class="num hop-ibu">' + (d.ibuBreakdown[i] || 0).toFixed(1) + '</td>' +
    '<td><input type="number" step="0.01" data-tbl="hops" data-field="cost" value="' + (h.cost || 0) + '"/></td>' +
    '<td class="row-actions"><button class="btn btn-sm" data-substitute="hops">Sub</button><button class="btn btn-sm" data-save-item="hops">Save</button><button class="del-btn" data-del="hops">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="9">No hops yet</td></tr>';

  const miscRows = r.misc.length ? r.misc.map((m, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><input data-tbl="misc" data-field="name" value="' + escapeHtml(m.name) + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="misc" data-field="amount" value="' + m.amount + '"/></td>' +
    '<td><select data-tbl="misc" data-field="unit">' + ["g", "oz", "tsp", "tablet", "item"].map(u => '<option ' + (m.unit === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
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
    '<div class="field"><label>Style</label><select data-field="styleName">' + styleOptions + '</select></div>' +
    '</div></div>' +
    '<div class="card"><h3>Fermentables <button class="btn btn-sm" data-action="addFermentable">+ Add Fermentable</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:22%">Name</th><th>Amount (' + uLabel("weight-lb") + ')</th><th>Type</th><th>PPG</th><th>Colour (' + uLabel("color-srm") + ')</th><th>% Grist</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + fermRows + '</tbody></table></div>' +
    '<div class="card"><h3>Hops <button class="btn btn-sm" data-action="addHop">+ Add Hop</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:18%">Name</th><th>Amount (' + uLabel("weight-oz") + ')</th><th>Alpha %</th><th>Time (min)</th><th>Use</th><th>Stand Temp (' + uLabel("temp-f") + ')</th><th>IBU</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + hopRows + '</tbody></table></div>' +
    '<div class="card"><h3>Yeast <span><button class="btn btn-sm" data-substitute="yeast">Substitute</button> <button class="btn btn-sm" data-save-item="yeast">Save Item</button></span></h3><div class="field-grid">' +
    '<div class="field"><label>Strain</label><select data-field="yeastName">' + buildIngredientSelect(yeastLibrary, r.yeast.name) + '</select></div>' +
    '<div class="field"><label>Attenuation (%)</label><input type="number" step="1" data-field="yeastAttenuation" value="' + (r.yeast.attenuation * 100).toFixed(0) + '"/></div>' +
    '<div class="field"><label>Cost ($)</label><input type="number" step="0.01" data-field="yeastCost" value="' + (r.yeast.cost || 0) + '"/></div>' +
    '</div></div>' +
    '<div class="card"><h3>Misc / Fining Agents <button class="btn btn-sm" data-action="addMisc">+ Add Item</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:34%">Name</th><th>Amount</th><th>Unit</th><th>Use</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + miscRows + '</tbody></table></div>' +
    '<div class="card"><h3>Cost & Batch Stats</h3><div class="field-grid">' +
    '<div class="field"><label>Pre-Boil Volume (' + uLabel("volume-gal") + ', blank = auto)</label><input type="number" step="0.1" data-field="preBoilVolGal" data-unitkind="volume-gal" value="' + (r.preBoilVolGal ? uVal(r.preBoilVolGal, "volume-gal") : "") + '" placeholder="' + uVal(d.preBoilVolGal, "volume-gal").toFixed(2) + '"/></div>' +
    '</div>' +
    '<div class="stat-row"><span class="stat-label">Pre-Boil Gravity</span><span class="stat-value preboil-gravity">' + d.preBoilGravity.toFixed(3) + ' (at ' + uVal(d.preBoilVolGal, "volume-gal").toFixed(2) + ' ' + uLabel("volume-gal") + ')</span></div>' +
    '<div class="stat-row"><span class="stat-label">' + (uLabel("weight-lb") === "kg" ? "Kilograms" : "Pounds") + ' per Barrel</span><span class="stat-value lb-per-barrel">' + uVal(d.poundsPerBarrel, "weight-lb").toFixed(2) + '</span></div>' +
    '<div class="stat-row"><span class="stat-label">Total Recipe Cost</span><span class="stat-value total-cost">$' + d.cost.toFixed(2) + '</span></div>' +
    '</div>' +
    '<div class="card"><h3>Style Guide Comparison</h3>' + (style ? styleCompareHtml(r, style) : '<p style="color:var(--ink-faint);font-size:13px;">Pick a style above to compare.</p>') + '</div>'
  );
}

function styleCompareHtml(r, style) {
  const d = computeDerived(r);
  const rows = [
    ["Original Gravity", d.og, style.og, v => v.toFixed(3)],
    ["Final Gravity", d.fg, style.fg, v => v.toFixed(3)],
    ["ABV", d.abv, style.abv, v => v.toFixed(1) + "%"],
    ["Bitterness (IBU)", d.ibu, style.ibu, v => Math.round(v)],
    ["Colour (" + uLabel("color-srm") + ")", uVal(d.srm, "color-srm"), style.srm.map(v => uVal(v, "color-srm")), v => v.toFixed(1)],
  ];
  return rows.map(row => {
    const label = row[0], val = row[1], range = row[2], fmt = row[3];
    const lo = range[0], hi = range[1];
    const spanLo = Math.min(lo, val) - (hi - lo) * 0.15, spanHi = Math.max(hi, val) + (hi - lo) * 0.15;
    const pct = v => ((v - spanLo) / (spanHi - spanLo)) * 100;
    const inRange = Calc.inRange(val, range);
    return '<div class="style-compare-row ' + (inRange ? "" : "out") + '"><div class="metric-name">' + label + '</div>' +
      '<div class="track"><div class="band" style="left:' + pct(lo) + '%; width:' + (pct(hi) - pct(lo)) + '%;"></div><div class="dot" style="left:' + pct(val) + '%;"></div></div>' +
      '<div class="value-label">' + fmt(val) + '</div></div>';
  }).join("");
}

// ---- Water tab ----
function waterTabHtml(r, d) {
  const t = r.waterTarget;
  const ionInputs = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"].map(ion =>
    '<div class="ion-box"><div class="ion-name">' + ion + '</div>' +
    '<input type="number" step="1" data-field="waterBase.' + ion + '" value="' + (r.waterBase[ion] || 0) + '" style="width:100%;text-align:center;background:transparent;border:none;color:var(--amber);font-family:\'JetBrains Mono\',monospace;font-size:17px;margin-top:4px;"/></div>'
  ).join("");
  const adjustedIons = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"].map(ion =>
    '<div class="ion-box"><div class="ion-name">' + ion + '</div><div class="ion-value">' + Math.round(d.finalWater[ion]) + '</div></div>'
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
    '<div class="card"><h3>Base Water Profile</h3><div class="field-grid">' +
    '<div class="field"><label>Source Name</label><input data-field="waterBaseName" value="' + escapeHtml(r.waterBaseName) + '"/></div>' +
    '<div class="field"><label>Mash Water (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-field="mashWaterVolGal" data-unitkind="volume-gal" value="' + uVal(r.mashWaterVolGal, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Sparge Water (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-field="spargeWaterVolGal" data-unitkind="volume-gal" value="' + uVal(r.spargeWaterVolGal, "volume-gal") + '"/></div>' +
    '<div class="field"><label>Total Water Needed</label><input disabled value="' + (uVal(r.mashWaterVolGal, "volume-gal") + uVal(r.spargeWaterVolGal, "volume-gal")).toFixed(2) + ' ' + uLabel("volume-gal") + '"/></div>' +
    '</div><div class="ion-grid" style="margin-top:14px;">' + ionInputs + '</div></div>' +
    '<div class="card"><h3>Mash & Sparge Water Agents<span><select id="targetProfileSelect" class="btn btn-sm">' + targetOptions + '</select>' +
    '<button class="btn btn-sm" data-action="addSalt">+ Add Salt</button></span></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:36%">Salt</th><th>Amount (g)</th><th>Use</th><th></th></tr></thead><tbody>' + saltRows + '</tbody></table></div>' +
    '<div class="card"><h3>Acid Additions</h3><div class="field-grid">' +
    '<div class="field"><label>Mash Acid</label><select data-field="mashAcid.type">' + acidTypeOptions(r.mashAcid.type) + '</select></div>' +
    '<div class="field"><label>Mash Acid Amount (mL)</label><input type="number" step="0.1" data-field="mashAcid.amountMl" value="' + r.mashAcid.amountMl + '"/></div>' +
    '<div class="field"><label>Sparge Acid</label><select data-field="spargeAcid.type">' + acidTypeOptions(r.spargeAcid.type) + '</select></div>' +
    '<div class="field"><label>Sparge Acid Amount (mL)</label><input type="number" step="0.1" data-field="spargeAcid.amountMl" value="' + r.spargeAcid.amountMl + '"/></div>' +
    '</div><p style="color:var(--ink-faint);font-size:12px;margin:10px 0 0;">Tracked for reference only \u2014 not currently factored into the residual alkalinity estimate below (proper mash pH prediction needs a grain-acidity model beyond what Hops calculates).</p></div>' +
    '<div class="card"><h3>Adjusted Mash Water Profile</h3><div class="ion-grid">' + adjustedIons + '</div></div>' +
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
    '<div class="field" style="display:flex; align-items:flex-end; gap:6px; padding-bottom:6px;"><label style="display:flex; align-items:center; gap:6px; margin:0; text-transform:none; font-size:13px; color:var(--ink);"><input type="checkbox" id="adjustTempForEquip" ' + (r.adjustTempForEquip ? "checked" : "") + ' ' + (equip ? "" : "disabled") + '/> Adjust Temp for Equipment</label></div>' +
    '</div>' +
    (equip ? "" : '<p style="color:var(--ink-faint);font-size:12px;margin:6px 0 0;">Link an Equipment Profile on the Design tab to enable the equipment thermal-mass adjustment.</p>') +
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
      '<p style="color:var(--ink-faint);font-size:13px;">No brews logged yet for this recipe. Start a batch to track brew-day readings, and use what you learn to tweak the next version.</p>') +
    '</div>'
  );
}

// ---- Event wiring for recipe tab panel ----
function wireTabEvents(r) {
  const panel = document.getElementById("tabPanel");
  panel.querySelectorAll("[data-field]").forEach(el => {
    if (el.closest("[data-tbl]")) return;
    if (el.dataset.field === "preBoilVolGal") return; // handled specially below (empty = auto)
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
      if (field === "name" && val === "__custom__") {
        const name = window.prompt("Name for this custom " + (tbl === "fermentables" ? "fermentable" : "hop") + ":", r[tbl][idx].name);
        if (!name) { renderMain(); return; } // cancelled - re-render to reset the select back to its previous value
        val = name;
      }
      r[tbl][idx][field] = val;
      if (field === "name" && tbl === "fermentables") {
        const match = state.inventory.fermentables.find(f => f.name.toLowerCase() === String(val).toLowerCase());
        if (match) { r.fermentables[idx].ppg = match.ppg; r.fermentables[idx].color = match.srm; r.fermentables[idx].type = match.type; r.fermentables[idx].mashable = match.mashable; }
        else { const row = Object.assign(newInventoryItem("fermentables"), { name: val }); state.inventory.fermentables.push(row); }
      }
      if (field === "name" && tbl === "hops") {
        const match = state.inventory.hops.find(h => h.name.toLowerCase() === String(val).toLowerCase());
        if (match) r.hops[idx].alphaPct = match.alpha;
        else { const row = Object.assign(newInventoryItem("hops"), { name: val }); state.inventory.hops.push(row); }
      }
      saveToStorage();
      if ((field === "name" && (tbl === "fermentables" || tbl === "hops")) || (field === "use" && tbl === "hops")) renderMain(); else refreshComputed(r);
    });
  });
  panel.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", () => {
    const tbl = btn.dataset.del, idx = Number(btn.closest("[data-idx]").dataset.idx);
    r[tbl].splice(idx, 1); saveToStorage(); renderMain();
  }));
  const actions = {
    addFermentable: () => r.fermentables.push({ name: FERMENTABLES[0].name, type: FERMENTABLES[0].type, amountLb: 1, ppg: FERMENTABLES[0].ppg, color: FERMENTABLES[0].srm, mashable: FERMENTABLES[0].mashable, cost: 0 }),
    addHop: () => r.hops.push({ name: HOPS[0].name, amountOz: 1, alphaPct: HOPS[0].alpha, timeMin: 60, use: "Boil", whirlpoolTempF: 194, cost: 0 }),
    addMisc: () => r.misc.push({ name: "Whirlfloc Tablet", amount: 1, unit: "tablet", use: "Boil", cost: 0 }),
    addSalt: () => r.waterSalts.push({ name: Object.keys(WATER_SALTS)[0], grams: 1 }),
    addMashStep: () => r.mashSteps.push({ name: "Mash Out", temp: 168, time: 10 }),
    startBatchFromRecipe: () => { const b = newBatch(r.id); state.batches.push(b); state.activeBatchId = b.id; state.activeSection = "batches"; saveToStorage(); renderAll(); },
  };
  panel.querySelectorAll("[data-action]").forEach(btn => { const fn = actions[btn.dataset.action]; if (fn) btn.addEventListener("click", () => { fn(); saveToStorage(); if (state.activeSection === "recipes") renderMain(); else renderAll(); }); });
  panel.querySelectorAll(".history-row").forEach(row => row.addEventListener("click", () => { state.activeBatchId = row.dataset.batchId; state.activeSection = "batches"; saveToStorage(); renderAll(); }));

  const yeastName = panel.querySelector('[data-field="yeastName"]');
  if (yeastName) yeastName.addEventListener("input", () => {
    let val = yeastName.value;
    if (val === "__custom__") {
      const name = window.prompt("Name for this custom yeast strain:", r.yeast.name);
      if (!name) { renderMain(); return; }
      val = name;
    }
    r.yeast.name = val;
    const match = state.inventory.yeast.find(y => y.name.toLowerCase() === val.toLowerCase());
    if (match) { r.yeast.attenuation = match.attenuation; r.yeast.type = match.type; }
    else { const row = Object.assign(newInventoryItem("yeast"), { name: val }); state.inventory.yeast.push(row); }
    saveToStorage();
    renderMain();
  });
  const yeastAtt = panel.querySelector('[data-field="yeastAttenuation"]');
  if (yeastAtt) yeastAtt.addEventListener("input", () => { r.yeast.attenuation = Number(yeastAtt.value) / 100; saveToStorage(); refreshComputed(r); });
  const yeastCost = panel.querySelector('[data-field="yeastCost"]');
  if (yeastCost) yeastCost.addEventListener("input", () => { r.yeast.cost = Number(yeastCost.value); saveToStorage(); refreshComputed(r); });

  const equipSel = panel.querySelector('[data-field="equipmentId"]');
  if (equipSel) equipSel.addEventListener("change", () => {
    r.equipmentId = equipSel.value || null;
    const eq = equipmentRef(r.equipmentId);
    if (eq) { r.batchVolGal = eq.batchVolGal; r.boilTimeMin = eq.boilTimeMin; r.efficiencyPct = eq.mashEfficiencyPct; r.spargeWaterVolGal = eq.trubLossGal + (eq.boilOffRateGalHr * eq.boilTimeMin / 60); }
    saveToStorage(); renderMain();
    if (eq) toast('Applied "' + eq.name + '" equipment defaults');
  });
  const styleSel = panel.querySelector('[data-field="styleName"]');
  if (styleSel) styleSel.addEventListener("change", () => { r.styleName = styleSel.value; saveToStorage(); renderMain(); });
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

  // ---- Substitute & Save Item (personal ingredient library) ----
  panel.querySelectorAll("[data-substitute]").forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    openSubstitutePicker(e, btn.dataset.substitute, btn.closest("[data-idx]"), r);
  }));
  panel.querySelectorAll("[data-save-item]").forEach(btn => btn.addEventListener("click", () => {
    saveItemToLibrary(btn.dataset.saveItem, btn.closest("[data-idx]"), r);
  }));
}

function openSubstitutePicker(e, kind, rowEl, r) {
  let library, applyFn;
  if (kind === "fermentables") {
    library = state.inventory.fermentables;
    applyFn = (item) => {
      const idx = Number(rowEl.dataset.idx);
      snapshotUndo(r);
      Object.assign(r.fermentables[idx], { name: item.name, ppg: item.ppg, color: item.srm, type: item.type, mashable: item.mashable });
      saveToStorage(); renderMain(); toast("Substituted " + item.name);
    };
  } else if (kind === "hops") {
    library = state.inventory.hops;
    applyFn = (item) => {
      const idx = Number(rowEl.dataset.idx);
      snapshotUndo(r);
      r.hops[idx].name = item.name; r.hops[idx].alphaPct = item.alpha;
      saveToStorage(); renderMain(); toast("Substituted " + item.name);
    };
  } else {
    library = state.inventory.yeast;
    applyFn = (item) => {
      snapshotUndo(r);
      r.yeast.name = item.name; r.yeast.attenuation = item.attenuation; r.yeast.type = item.type;
      saveToStorage(); renderMain(); toast("Substituted " + item.name);
    };
  }
  const items = library.map(item => ({ label: item.name, action: () => applyFn(item) }));
  showContextMenu(e.clientX, e.clientY, items.length ? items : [{ label: "No ingredients available", action: () => {} }]);
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
  const catalogue = { fermentables: FERMENTABLES, hops: HOPS, yeast: YEASTS }[kind];
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
    if (headers[0]) headers[0].closest(".card").innerHTML = '<h3>Style Guide Comparison</h3>' + (style ? styleCompareHtml(r, style) : '<p style="color:var(--ink-faint);font-size:13px;">Pick a style above to compare.</p>');
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
    document.querySelectorAll(".ion-value").forEach((el, i) => { const ion = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"][i]; if (ion) el.textContent = Math.round(d.finalWater[ion]); });
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
  main.innerHTML =
    '<div class="recipe-header"><h1 class="display" style="margin:0;font-size:28px;">' + escapeHtml(b.recipeName) + '</h1><div class="header-actions"><button class="btn btn-sm" id="shareBatchBtn">Share</button><button class="btn btn-sm btn-danger" id="deleteBatchBtn">Delete Batch</button></div></div>' +
    '<div class="card"><h3>Status</h3><div style="display:flex; gap:8px; flex-wrap:wrap;">' + statusBtns + '</div></div>' +
    '<div class="card"><h3>Brew Day</h3><div class="field-grid">' +
    '<div class="field"><label>Recipe</label><select id="batchRecipeSelect">' + recipeOptions + '</select></div>' +
    '<div class="field"><label>Brew Date</label><input type="date" data-bfield="brewDate" value="' + b.brewDate + '"/></div>' +
    '<div class="field"><label>Measured OG</label><input type="number" step="0.001" data-bfield="measuredOG" value="' + (b.measuredOG != null ? b.measuredOG : "") + '" placeholder="' + (d ? d.og.toFixed(3) : "1.050") + '"/></div>' +
    '<div class="field"><label>Measured FG</label><input type="number" step="0.001" data-bfield="measuredFG" value="' + (b.measuredFG != null ? b.measuredFG : "") + '" placeholder="' + (d ? d.fg.toFixed(3) : "1.010") + '"/></div>' +
    '</div></div>' +
    (d ? '<div class="card"><h3>Estimated vs. Actual</h3>' +
      batchCompareRow("Original Gravity", d.og.toFixed(3), b.measuredOG ? Number(b.measuredOG).toFixed(3) : null) +
      batchCompareRow("Final Gravity", d.fg.toFixed(3), b.measuredFG ? Number(b.measuredFG).toFixed(3) : null) +
      (b.measuredOG && b.measuredFG ? batchCompareRow("ABV", d.abv.toFixed(1) + "%", Calc.estimateABV(Number(b.measuredOG), Number(b.measuredFG)).toFixed(1) + "%") : "") +
      '</div>' : "") +
    '<div class="card"><h3>Ingredients Needed <button class="btn btn-sm" id="deductInventoryBtn">Deduct from Inventory</button></h3>' +
    (r ? '<table class="ing-table"><tbody>' +
      r.fermentables.map(f => '<tr><td>' + escapeHtml(f.name) + '</td><td class="num">' + uVal(f.amountLb, "weight-lb").toFixed(2) + ' ' + uLabel("weight-lb") + '</td></tr>').join("") +
      r.hops.map(h => '<tr><td>' + escapeHtml(h.name) + '</td><td class="num">' + uVal(h.amountOz, "weight-oz").toFixed(2) + ' ' + uLabel("weight-oz") + '</td></tr>').join("") +
      '<tr><td>' + escapeHtml(r.yeast.name) + '</td><td class="num">1 pkg</td></tr></tbody></table>' : '<p style="color:var(--ink-faint);">Original recipe was deleted.</p>') +
    '</div>' +
    '<div class="card"><h3>Batch Notes</h3><textarea class="notes-area" id="batchNotes" placeholder="Brew day observations, gravity readings, off-flavours, timing...">' + escapeHtml(b.notes) + '</textarea></div>';

  main.querySelectorAll("[data-status]").forEach(btn => btn.addEventListener("click", () => { b.status = btn.dataset.status; saveToStorage(); renderAll(); }));
  document.getElementById("shareBatchBtn").addEventListener("click", () => shareBatch(b));
  document.getElementById("deleteBatchBtn").addEventListener("click", () => {
    if (!confirm("Delete this batch record?")) return;
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
  main.querySelectorAll("[data-bfield]").forEach(el => el.addEventListener("input", () => {
    const val = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
    b[el.dataset.bfield] = val; saveToStorage();
    if (el.dataset.bfield !== "brewDate") renderMain(); else renderSidebar();
  }));
  document.getElementById("batchNotes").addEventListener("input", e => { b.notes = e.target.value; saveToStorage(); });
  document.getElementById("deductInventoryBtn").addEventListener("click", () => deductInventoryForBatch(r));
}
function batchCompareRow(label, est, actual) { return '<div class="stat-row"><span class="stat-label">' + label + '</span><span class="stat-value">' + est + ' est' + (actual ? ' \u2192 ' + actual + ' actual' : "") + '</span></div>'; }
function deductInventoryForBatch(r) {
  if (!r) return;
  let deducted = 0;
  r.fermentables.forEach(f => { const item = state.inventory.fermentables.find(i => i.name.toLowerCase() === f.name.toLowerCase()); if (item) { item.stock -= Units.toDisplay(f.amountLb, "weight-lb", state.unitSystem); deducted++; } });
  r.hops.forEach(h => { const item = state.inventory.hops.find(i => i.name.toLowerCase() === h.name.toLowerCase()); if (item) { item.stock -= Units.toDisplay(h.amountOz, "weight-oz", state.unitSystem); deducted++; } });
  const yeastItem = state.inventory.yeast.find(i => i.name.toLowerCase() === r.yeast.name.toLowerCase());
  if (yeastItem) { yeastItem.stock -= 1; deducted++; }
  saveToStorage();
  toast(deducted ? "Deducted " + deducted + " item(s) from inventory" : "No matching inventory items found");
}
function handleNewBatch() { const r = state.recipes[0]; const b = newBatch(r.id); state.batches.push(b); state.activeBatchId = b.id; saveToStorage(); renderAll(); toast("New batch started"); }

// ================= INVENTORY =================
const INVENTORY_KINDS = [["fermentables", "Fermentables"], ["hops", "Hops"], ["yeast", "Yeast"], ["misc", "Misc / Fining"]];
const CATALOGUE_KINDS = ["fermentables", "hops", "yeast"]; // kinds backed by data.js + region bulk-add
function renderInventoryMain(main) {
  const filterChips = '<button class="btn btn-sm" data-region-chip="__all__" style="' + (state.inventoryRegionFilter.length === 0 ? "font-weight:700;text-decoration:underline;" : "") + '">All Regions</button>' +
    REGIONS.map(r => '<button class="btn btn-sm" data-region-chip="' + escapeHtml(r) + '" style="' + (state.inventoryRegionFilter.includes(r) ? "font-weight:700;text-decoration:underline;" : "") + '">' + escapeHtml(r) + '</button>').join("");
  main.innerHTML = '<div class="recipe-header"><h1 class="display" style="margin:0;font-size:28px;">Inventory</h1></div>' +
    '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:6px;"><label style="font-size:13px; color:var(--ink-faint);">Filter:</label>' + filterChips + '</div>' +
    '<p style="color:var(--ink-faint); font-size:13px; margin:0 0 16px;">This list feeds the Fermentables/Hops/Yeast dropdowns on every recipe \u2014 add an ingredient here and it shows up there, and picking a brand-new name in a recipe adds it here too. \u201c+ Add Region\u201d pulls in the built-in specs for a country\u2019s hops/malts/yeast (there\u2019s no live database behind this \u2014 see REFRESH_CATALOGUE.md for how the list gets refreshed). Click one or more region chips above to hide everything else from view here \u2014 nothing is removed, and every item still shows up in recipe dropdowns regardless of the filter.</p>' +
    INVENTORY_KINDS.map(pair => inventoryCardHtml(pair[0], pair[1])).join("");

  main.querySelectorAll("[data-region-chip]").forEach(btn => btn.addEventListener("click", () => {
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
    saveToStorage(); renderMain();
    toast(added ? "Added " + added + " " + region + " item(s)" : "Already have everything from " + region);
  }));
  main.querySelectorAll("[data-add-all-btn]").forEach(btn => btn.addEventListener("click", () => {
    const kind = btn.dataset.addAllBtn;
    const added = addRegionToInventory(kind, "__all__");
    saveToStorage(); renderMain();
    toast(added ? "Added " + added + " item(s) from every region" : "Already have the full catalogue");
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
    ? '<select class="btn btn-sm" data-region-select="' + kind + '">' + REGIONS.map(r => '<option ' + (r === state.region ? "selected" : "") + '>' + escapeHtml(r) + '</option>').join("") + '</select>' +
      '<button class="btn btn-sm" data-add-region-btn="' + kind + '">+ Add Region</button>' +
      '<button class="btn btn-sm" data-add-all-btn="' + kind + '">+ Add All Regions</button>'
    : "";
  return '<div class="card"><h3>' + label + ' <span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;">' + regionControls + ' <button class="btn btn-sm" data-add-kind="' + kind + '">+ Add Item</button></span></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:22%">Name</th>' + originHeader + specHeaders + '<th>Stock</th><th>Unit</th><th>Cost / unit ($)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function inventoryRowHtml(kind, item, i) {
  const unitOptions = ["kg", "g", "lb", "oz", "pkg", "tablet", "item"];
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
  main.innerHTML = '<div class="recipe-header"><h1 class="display" style="margin:0;font-size:28px;">Equipment Profiles</h1><div class="header-actions"><button class="btn btn-primary btn-sm" id="addEquipBtn">+ New Profile</button></div></div>' +
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
  main.querySelectorAll("[data-efield]").forEach(el => el.addEventListener("input", () => {
    const idx = Number(el.closest("[data-idx]").dataset.idx);
    let val = el.type === "number" ? Number(el.value) : el.value;
    if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
    state.equipment[idx][el.dataset.efield] = val; saveToStorage();
    if (el.dataset.efield === "name") renderMain();
  }));
  main.querySelectorAll("[data-del-equip]").forEach(btn => btn.addEventListener("click", () => { state.equipment.splice(Number(btn.dataset.delEquip), 1); saveToStorage(); renderMain(); }));
}

// ================= TOOLS =================
function renderToolsMain(main) {
  main.innerHTML =
    '<div class="recipe-header"><h1 class="display" style="margin:0;font-size:28px;">Quick Calculators</h1></div>' +
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
    '</div><div class="stat-row" style="margin-top:12px;"><span class="stat-label">Corrected Gravity</span><span class="stat-value" id="calcHydroOut">\u2014</span></div></div>';

  const abvOut = document.getElementById("calcABVOut");
  const updateABV = () => { const og = Number(document.getElementById("calcOG").value), fg = Number(document.getElementById("calcFG").value); abvOut.textContent = Calc.estimateABV(og, fg).toFixed(2) + "%"; };
  document.getElementById("calcOG").addEventListener("input", updateABV); document.getElementById("calcFG").addEventListener("input", updateABV); updateABV();

  const primeOut = document.getElementById("calcPrimeOut");
  const updatePrime = () => {
    const volGal = Units.toCanonical(Number(document.getElementById("calcPrimeVol").value), "volume-gal", state.unitSystem);
    const tempF = Units.toCanonical(Number(document.getElementById("calcPrimeTemp").value), "temp-f", state.unitSystem);
    const target = Number(document.getElementById("calcPrimeTarget").value);
    const residual = 3.0378 - 0.050062 * tempF + 0.00026555 * tempF * tempF;
    const diff = Math.max(0, target - residual);
    const grams = 4 * Units.galToL(volGal) * diff;
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
}

// ---- Init ----
function seedDefaults() {
  state.tree = Tree.createRoot();
  if (!state.equipment.length) state.equipment = EQUIPMENT_PRESETS.map(p => newEquipment(p));
  if (!state.recipes.length) { const r = newRecipe(); state.recipes.push(r); state.activeId = r.id; state.tree.children.push(Tree.createLeaf(r.id)); }
}

function init() {
  const had = loadFromStorage();
  if (!had) seedDefaults();
  if (!state.tree) { state.tree = Tree.createRoot(); state.recipes.forEach(r => state.tree.children.push(Tree.createLeaf(r.id))); }
  if (!state.equipment) state.equipment = [];
  if (!state.batches) state.batches = [];
  if (!state.inventory) state.inventory = { fermentables: [], hops: [], yeast: [], misc: [] };
  if (!state.customIngredients) state.customIngredients = { fermentables: [], hops: [], yeast: [] };
  if (!state.unitSystem) state.unitSystem = "metric";
  if (!state.region) state.region = "New Zealand";
  if (!Array.isArray(state.inventoryRegionFilter)) state.inventoryRegionFilter = ["New Zealand", "Australia", "Custom"];
  state.recipes.forEach(migrateRecipe);
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
    el.innerHTML = '<p style="font-size:11px;color:var(--ink-faint);margin:0 0 8px;">Local file linking needs Chrome or Edge \u2014 use Export/Import below on this browser instead.</p>';
    return;
  }
  el.innerHTML =
    '<div style="display:flex; gap:8px; margin-bottom:6px;">' +
    '<button class="btn btn-sm" id="openFileBtn" style="flex:1;">Open File\u2026</button>' +
    '<button class="btn btn-sm btn-primary" id="saveFileBtn" style="flex:1;">' + (FileWorkspace.linkedName ? "Save" : "Save As\u2026") + '</button>' +
    '</div>' +
    '<p style="font-size:11px;color:var(--ink-faint);margin:0 0 10px;">' +
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
    if (state.recipes.length && !confirm('Open "' + FileWorkspace.linkedName + '"? This replaces everything currently shown in Hops (including this browser\'s own autosave) with the file\'s contents.')) {
      FileWorkspace.unlink();
      return;
    }
    const restored = Security.sanitizeDeep(data);
    (restored.recipes || []).forEach(migrateRecipe);
    if (!restored.tree) { restored.tree = Tree.createRoot(); (restored.recipes || []).forEach(r => restored.tree.children.push(Tree.createLeaf(r.id))); }
    Tree.pruneOrphans(restored.tree, new Set((restored.recipes || []).map(r => r.id)));
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, restored, { activeSection: "recipes", activeId: (restored.recipes && restored.recipes[0]) ? restored.recipes[0].id : null, activeTab: "design", activeBatchId: null });
    if (!state.equipment) state.equipment = [];
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
