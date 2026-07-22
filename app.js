// ---- Hops app: state, rendering, events ----
const escapeHtml = s => Security.escapeHtml(s);
const STORAGE_KEY = "hops.state.v1";

let state = {
  recipes: [],
  tree: null,
  batches: [],
  equipment: [],
  inventory: { fermentables: [], hops: [], yeast: [], misc: [] },
  unitSystem: "metric", // NZ default. "us" is the alternative.
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
    fermentables: [{ name: "Maris Otter (Crisp)", type: "Grain", amountLb: 10, ppg: 37, color: 4, mashable: true, cost: 0 }],
    hops: [{ name: "Cascade", amountOz: 1, alphaPct: 6.0, timeMin: 60, use: "Boil", cost: 0 }],
    yeast: { name: "American Ale (Wyeast #1056)", type: "Ale", attenuation: 0.75, cost: 0 },
    misc: [],
    waterVolGal: 6,
    waterBaseName: "Custom",
    waterBase: { Ca: 50, Mg: 5, Na: 10, SO4: 30, Cl: 30, HCO3: 50 },
    waterSalts: [],
    waterTarget: "Balanced Pale Ale",
    mashProfileName: "Single Infusion, Full Body",
    mashSteps: JSON.parse(JSON.stringify(MASH_PROFILES["Single Infusion, Full Body"])),
    carbLevelVols: 2.4,
    fermentationProfile: "Ferment at 20\u00b0C for 10-14 days, then condition 2 weeks.",
    notes: "",
  };
}
function newEquipment(preset) {
  const p = preset || EQUIPMENT_PRESETS[0];
  return { id: uid(), name: p.name, batchVolGal: p.batchVolGal, boilTimeMin: p.boilTimeMin, boilOffRateGalHr: p.boilOffRateGalHr, trubLossGal: p.trubLossGal, mashEfficiencyPct: p.mashEfficiencyPct };
}
function newBatch(recipeId) {
  const r = state.recipes.find(x => x.id === recipeId);
  return { id: uid(), recipeId, recipeName: r ? r.name : "Unknown Recipe", status: "Planning", brewDate: new Date().toISOString().slice(0, 10), measuredOG: null, measuredFG: null, notes: "" };
}
function newInventoryItem(kind) {
  const defaults = { fermentables: "kg", hops: "g", yeast: "pkg", misc: "g" };
  return { id: uid(), name: "", stock: 0, unit: defaults[kind] || "unit", cost: 0 };
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

function activeRecipe() { return state.recipes.find(r => r.id === state.activeId); }
function activeBatch() { return state.batches.find(b => b.id === state.activeBatchId); }
function styleRef(name) { return STYLES.find(s => s.name === name); }
function equipmentRef(id) { return state.equipment.find(e => e.id === id); }

// ---- Derived stats (self-contained ingredients, no external DB lookups needed) ----
function computeDerived(r) {
  const ferms = r.fermentables.map(f => ({ amountLb: Number(f.amountLb) || 0, ppg: Number(f.ppg) || 0, srm: Number(f.color) || 0, mashable: f.mashable !== false }));
  const og = Calc.estimateOG(ferms, Number(r.batchVolGal) || 1, Number(r.efficiencyPct) || 70);
  const fg = Calc.estimateFG(og, Number(r.yeast.attenuation) || 0.75);
  const abv = Calc.estimateABV(og, fg);
  const hopsForCalc = r.hops.map(h => ({ amountOz: Number(h.amountOz) || 0, alphaPct: Number(h.alphaPct) || 0, timeMin: Number(h.timeMin) || 0, use: h.use }));
  const ibu = Calc.estimateIBU(hopsForCalc, Number(r.batchVolGal) || 1, og);
  const srm = Calc.estimateSRM(ferms, Number(r.batchVolGal) || 1);
  const cost = Calc.totalCost([...r.fermentables, ...r.hops, r.yeast, ...r.misc]);
  const added = Calc.saltAdditions(r.waterSalts.map(s => ({ name: s.name, grams: Number(s.grams) || 0 })), Number(r.waterVolGal) || 1);
  const finalWater = Calc.addProfiles(r.waterBase, added);
  const ra = Calc.residualAlkalinity(finalWater);
  const soCl = Calc.sulfateChlorideRatio(finalWater);
  return { og, fg, abv, ibu, srm, cost, finalWater, ra, soCl };
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
  const adapter = pickImportAdapter(file.name);
  if (!adapter) { toast("Unsupported file type for import"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const recipes = adapter.parse(reader.result);
      if (!recipes.length) { toast("No valid recipes found in file"); return; }
      recipes.forEach(rec => { rec.id = uid(); state.recipes.push(rec); addLeafToRoot(rec.id); });
      state.activeId = state.recipes[state.recipes.length - 1].id;
      state.activeSection = "recipes";
      saveToStorage(); renderAll();
      toast("Imported " + recipes.length + " recipe(s) via " + adapter.label);
    } catch (e) {
      toast("Could not read that file: " + e.message);
      console.error(e);
    }
  };
  reader.readAsText(file);
}
function addLeafToRoot(recipeId) { state.tree.children.push(Tree.createLeaf(recipeId)); }

// ---- Scale recipe ----
function scaleRecipe(r) {
  const label = Units.unitLabel("volume-gal", state.unitSystem);
  const currentDisplay = Units.toDisplay(r.batchVolGal, "volume-gal", state.unitSystem).toFixed(2);
  const input = window.prompt('Scale "' + r.name + '" to a new batch size (' + label + '):', currentDisplay);
  if (input === null) return;
  const newDisplay = Number(input);
  if (!newDisplay || newDisplay <= 0) { toast("Enter a valid batch size"); return; }
  const newVolGal = Units.toCanonical(newDisplay, "volume-gal", state.unitSystem);
  const ratio = newVolGal / r.batchVolGal;
  r.fermentables.forEach(f => f.amountLb = +(f.amountLb * ratio).toFixed(3));
  r.hops.forEach(h => h.amountOz = +(h.amountOz * ratio).toFixed(3));
  r.misc.forEach(m => m.amount = +(m.amount * ratio).toFixed(3));
  r.waterVolGal = +(r.waterVolGal * ratio).toFixed(2);
  r.batchVolGal = +newVolGal.toFixed(2);
  saveToStorage(); renderAll();
  toast("Scaled to " + newDisplay + " " + label);
}

// ---- Sharing ----
async function shareRecipe(r) {
  try {
    const encoded = await Share.encodeRecipe(r);
    const fullUrl = Share.buildShareUrl(encoded);
    showModal(
      '<h3>Share "' + escapeHtml(r.name) + '"</h3>' +
      '<p style="color:var(--ink-faint);font-size:13px;">This link contains the whole recipe. Anyone who opens it can view it and choose to add it to their own Hops.</p>' +
      '<input class="share-link-input" id="shareLinkInput" readonly value="' + escapeHtml(fullUrl) + '"/>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn btn-primary" id="copyLinkBtn" style="flex:1;">Copy Link</button>' +
      '<button class="btn" id="shortenLinkBtn" style="flex:1;">Shorten via b0x.nz</button>' +
      '</div>' +
      '<div style="margin-top:14px;text-align:right;"><button class="btn btn-sm" id="closeModalBtn">Close</button></div>',
      overlay => {
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
    );
  } catch (e) {
    toast("Could not create share link: " + e.message);
  }
}

async function checkIncomingShare() {
  const encoded = Share.readFromLocation();
  if (!encoded) return;
  try {
    const incoming = await Share.decodeRecipe(encoded);
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
  } catch (e) {
    toast("Shared link could not be read: " + e.message);
    Share.clearFromLocation();
  }
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
    row.style.paddingLeft = (depth * 16) + "px";
    row.dataset.nodeId = child.id;
    row.dataset.nodeType = child.type;
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
    items.push({ label: "New Recipe Here", action: () => { const r = newRecipe(); state.recipes.push(r); node.children.push(Tree.createLeaf(r.id)); state.activeId = r.id; state.activeTab = "design"; saveToStorage(); renderAll(); } });
    items.push({ label: "New Folder Here", action: () => { node.children.push(Tree.createFolder("New Folder")); saveToStorage(); renderSidebar(); } });
    items.push({ label: "Rename Folder", action: () => { const name = window.prompt("Folder name:", node.name); if (name) { Tree.renameNode(state.tree, node.id, name); saveToStorage(); renderSidebar(); } } });
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
        const copy = JSON.parse(JSON.stringify(r)); copy.id = uid(); copy.name = r.name + " (copy)";
        state.recipes.push(copy);
        const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
        const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
        parentNode.children.push(Tree.createLeaf(copy.id));
        state.activeId = copy.id; saveToStorage(); renderAll(); toast("Recipe cloned");
      }});
      items.push({ label: "Rename", action: () => { const name = window.prompt("Recipe name:", r.name); if (name) { r.name = name; saveToStorage(); renderAll(); } } });
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
    '<button class="btn btn-sm" id="dupBtn">Duplicate</button>' +
    '<button class="btn btn-sm" id="exportXmlBtn">Export BeerXML</button>' +
    '<button class="btn btn-sm" id="exportOneBtn">Export JSON</button>' +
    '<button class="btn btn-sm btn-danger" id="deleteBtn">Delete</button>' +
    '</div></div>' +
    renderGaugeStrip(d, style) +
    '<div class="tabs">' + tabBtn("design", "Design") + tabBtn("water", "Water") + tabBtn("mash", "Mash & Ferment") + tabBtn("history", "Brew History") + tabBtn("notes", "Notes") + '</div>' +
    '<div id="tabPanel"></div>';
  document.getElementById("recipeName").addEventListener("input", e => { r.name = e.target.value; saveToStorage(); renderSidebar(); });
  document.getElementById("shareBtn").addEventListener("click", () => shareRecipe(r));
  document.getElementById("scaleBtn").addEventListener("click", () => scaleRecipe(r));
  document.getElementById("dupBtn").addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(r)); copy.id = uid(); copy.name = r.name + " (copy)";
    state.recipes.push(copy);
    const leaf = Tree.findLeafByRecipeId(state.tree, r.id);
    const parentNode = (leaf && Tree.findParent(state.tree, leaf.id)) || state.tree;
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
function colorGaugeHtml(srm, range) {
  const inRange = range ? Calc.inRange(srm, range) : null;
  return '<div class="gauge ' + (inRange === false ? "out" : "") + '"><div class="label">Colour</div><div class="value" style="align-items:center;"><div class="color-swatch" style="background:' + Calc.srmToRgb(srm) + '"></div><span style="margin-left:8px;">' + srm.toFixed(1) + '<span class="unit">SRM</span></span></div>' +
    (range ? '<div class="range-label" style="margin-top:10px;">' + range[0] + '\u2013' + range[1] + ' style range</div>' : "") + '</div>';
}

function renderTabPanel(r, d, style) {
  const panel = document.getElementById("tabPanel");
  if (state.activeTab === "design") panel.innerHTML = designTabHtml(r, style);
  if (state.activeTab === "water") panel.innerHTML = waterTabHtml(r, d);
  if (state.activeTab === "mash") panel.innerHTML = mashTabHtml(r);
  if (state.activeTab === "history") panel.innerHTML = historyTabHtml(r);
  if (state.activeTab === "notes") panel.innerHTML = notesTabHtml(r);
  wireTabEvents(r);
}

function uLabel(kind) { return Units.unitLabel(kind, state.unitSystem); }
function uVal(canonical, kind) { return +Units.toDisplay(canonical, kind, state.unitSystem).toFixed(kind === "temp-f" ? 0 : 3); }

// ---- Design tab ----
function designTabHtml(r, style) {
  const fermOptions = FERMENTABLES.map(f => '<option value="' + escapeHtml(f.name) + '">').join("");
  const hopOptions = HOPS.map(h => '<option value="' + escapeHtml(h.name) + '">').join("");
  const yeastOptions = YEASTS.map(y => '<option value="' + escapeHtml(y.name) + '">').join("");
  const equipOptions = state.equipment.map(e => '<option value="' + e.id + '" ' + (r.equipmentId === e.id ? "selected" : "") + '>' + escapeHtml(e.name) + '</option>').join("");
  const styleOptions = STYLES.map(s => '<option ' + (r.styleName === s.name ? "selected" : "") + '>' + s.name + '</option>').join("");

  const fermRows = r.fermentables.length ? r.fermentables.map((f, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><input list="fermListDL" data-tbl="fermentables" data-field="name" value="' + escapeHtml(f.name) + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="fermentables" data-field="amountLb" data-unitkind="weight-lb" value="' + uVal(f.amountLb, "weight-lb") + '"/></td>' +
    '<td><select data-tbl="fermentables" data-field="type">' + ["Grain", "Adjunct", "Sugar", "Extract"].map(t => '<option ' + (f.type === t ? "selected" : "") + '>' + t + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.5" data-tbl="fermentables" data-field="ppg" value="' + f.ppg + '"/></td>' +
    '<td><input type="number" step="0.5" data-tbl="fermentables" data-field="color" value="' + f.color + '"/></td>' +
    '<td><input type="number" step="0.01" data-tbl="fermentables" data-field="cost" value="' + (f.cost || 0) + '"/></td>' +
    '<td><button class="del-btn" data-del="fermentables">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="7">No fermentables yet</td></tr>';

  const hopRows = r.hops.length ? r.hops.map((h, i) =>
    '<tr data-idx="' + i + '">' +
    '<td><input list="hopListDL" data-tbl="hops" data-field="name" value="' + escapeHtml(h.name) + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="hops" data-field="amountOz" data-unitkind="weight-oz" value="' + uVal(h.amountOz, "weight-oz") + '"/></td>' +
    '<td><input type="number" step="0.1" data-tbl="hops" data-field="alphaPct" value="' + h.alphaPct + '"/></td>' +
    '<td><input type="number" step="1" data-tbl="hops" data-field="timeMin" value="' + h.timeMin + '"/></td>' +
    '<td><select data-tbl="hops" data-field="use">' + ["Boil", "Whirlpool", "Dry Hop"].map(u => '<option ' + (h.use === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
    '<td><input type="number" step="0.01" data-tbl="hops" data-field="cost" value="' + (h.cost || 0) + '"/></td>' +
    '<td><button class="del-btn" data-del="hops">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="7">No hops yet</td></tr>';

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
    '<datalist id="fermListDL">' + fermOptions + '</datalist>' +
    '<datalist id="hopListDL">' + hopOptions + '</datalist>' +
    '<datalist id="yeastListDL">' + yeastOptions + '</datalist>' +
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
    '<table class="ing-table"><thead><tr><th style="width:26%">Name</th><th>Amount (' + uLabel("weight-lb") + ')</th><th>Type</th><th>PPG</th><th>Colour (SRM)</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + fermRows + '</tbody></table></div>' +
    '<div class="card"><h3>Hops <button class="btn btn-sm" data-action="addHop">+ Add Hop</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:22%">Name</th><th>Amount (' + uLabel("weight-oz") + ')</th><th>Alpha %</th><th>Time (min)</th><th>Use</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + hopRows + '</tbody></table></div>' +
    '<div class="card"><h3>Yeast</h3><div class="field-grid">' +
    '<div class="field"><label>Strain</label><input list="yeastListDL" data-field="yeastName" value="' + escapeHtml(r.yeast.name) + '"/></div>' +
    '<div class="field"><label>Attenuation (%)</label><input type="number" step="1" data-field="yeastAttenuation" value="' + (r.yeast.attenuation * 100).toFixed(0) + '"/></div>' +
    '<div class="field"><label>Cost ($)</label><input type="number" step="0.01" data-field="yeastCost" value="' + (r.yeast.cost || 0) + '"/></div>' +
    '</div></div>' +
    '<div class="card"><h3>Misc / Fining Agents <button class="btn btn-sm" data-action="addMisc">+ Add Item</button></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:34%">Name</th><th>Amount</th><th>Unit</th><th>Use</th><th>Cost ($)</th><th></th></tr></thead><tbody>' + miscRows + '</tbody></table></div>' +
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
    ["Colour (SRM)", d.srm, style.srm, v => v.toFixed(1)],
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
    '<td><button class="del-btn" data-del="waterSalts">\u2715</button></td></tr>'
  ).join("") : '<tr class="empty-row"><td colspan="3">No salt additions</td></tr>';

  return (
    '<div class="card"><h3>Base Water Profile</h3><div class="field-grid">' +
    '<div class="field"><label>Source Name</label><input data-field="waterBaseName" value="' + escapeHtml(r.waterBaseName) + '"/></div>' +
    '<div class="field"><label>Volume (' + uLabel("volume-gal") + ')</label><input type="number" step="0.1" data-field="waterVolGal" data-unitkind="volume-gal" value="' + uVal(r.waterVolGal, "volume-gal") + '"/></div>' +
    '</div><div class="ion-grid" style="margin-top:14px;">' + ionInputs + '</div></div>' +
    '<div class="card"><h3>Mash & Sparge Water Agents<span><select id="targetProfileSelect" class="btn btn-sm">' + targetOptions + '</select>' +
    '<button class="btn btn-sm" data-action="addSalt">+ Add Salt</button></span></h3>' +
    '<table class="ing-table"><thead><tr><th style="width:40%">Salt</th><th>Amount (g)</th><th></th></tr></thead><tbody>' + saltRows + '</tbody></table></div>' +
    '<div class="card"><h3>Adjusted Mash Water Profile</h3><div class="ion-grid">' + adjustedIons + '</div></div>' +
    '<div class="card"><h3>Water Analysis</h3>' +
    '<div class="stat-row"><span class="stat-label">Residual Alkalinity</span><span class="stat-value">' + d.ra.toFixed(1) + ' ppm as CaCO3</span></div>' +
    '<div class="stat-row"><span class="stat-label">Sulfate : Chloride Ratio</span><span class="stat-value">' + (isFinite(d.soCl) ? d.soCl.toFixed(2) : "\u2014") + ' (' + soClDescription(d.soCl) + ')</span></div>' +
    '</div>'
  );
}
function soClDescription(ratio) { if (!isFinite(ratio)) return "sulfate only"; if (ratio < 0.6) return "malty"; if (ratio <= 1.5) return "balanced"; return "hoppy / crisp"; }

// ---- Mash & Ferment tab ----
function mashTabHtml(r) {
  const steps = r.mashSteps.map((s, i) =>
    '<div class="mash-step" data-idx="' + i + '">' +
    '<input data-tbl="mashSteps" data-field="name" value="' + escapeHtml(s.name) + '"/>' +
    '<input type="number" data-tbl="mashSteps" data-field="temp" data-unitkind="temp-f" value="' + uVal(s.temp, "temp-f") + '" title="' + uLabel("temp-f") + '"/>' +
    '<input type="number" data-tbl="mashSteps" data-field="time" value="' + s.time + '" title="minutes"/>' +
    '<button class="del-btn" data-del="mashSteps">\u2715</button></div>'
  ).join("");
  const profileOptions = Object.keys(MASH_PROFILES).map(k => '<option ' + (r.mashProfileName === k ? "selected" : "") + '>' + k + '</option>').join("");
  return (
    '<div class="card"><h3>Mash Profile</h3><div class="field-grid"><div class="field"><label>Profile</label><select data-field="mashProfileName">' + profileOptions + '</select></div></div>' +
    '<div style="margin-top:16px;">' + steps + '<button class="btn btn-sm add-row-btn" data-action="addMashStep">+ Add Mash Step</button></div></div>' +
    '<div class="card"><h3>Carbonation</h3><div class="field-grid"><div class="field"><label>Target Volumes CO2</label><input type="number" step="0.1" data-field="carbLevelVols" value="' + r.carbLevelVols + '"/></div></div></div>' +
    '<div class="card"><h3>Fermentation Profile</h3><textarea class="notes-area" style="min-height:80px;" data-field="fermentationProfile">' + escapeHtml(r.fermentationProfile) + '</textarea></div>'
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
    el.addEventListener("input", () => {
      const path = el.dataset.field;
      let val = el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      setField(r, path, val); saveToStorage(); refreshComputed(r);
    });
  });
  panel.querySelectorAll("[data-tbl][data-field]").forEach(el => {
    el.addEventListener("input", () => {
      const tbl = el.dataset.tbl, idx = Number(el.closest("[data-idx]").dataset.idx), field = el.dataset.field;
      let val = el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.unitkind) val = Units.toCanonical(val, el.dataset.unitkind, state.unitSystem);
      r[tbl][idx][field] = val;
      if (field === "name" && tbl === "fermentables") {
        const match = FERMENTABLES.find(f => f.name.toLowerCase() === String(val).toLowerCase());
        if (match) { r.fermentables[idx].ppg = match.ppg; r.fermentables[idx].color = match.srm; r.fermentables[idx].type = match.type; r.fermentables[idx].mashable = match.mashable; }
      }
      if (field === "name" && tbl === "hops") {
        const match = HOPS.find(h => h.name.toLowerCase() === String(val).toLowerCase());
        if (match) r.hops[idx].alphaPct = match.alpha;
      }
      saveToStorage();
      if (field === "name" && (tbl === "fermentables" || tbl === "hops")) renderMain(); else refreshComputed(r);
    });
  });
  panel.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", () => {
    const tbl = btn.dataset.del, idx = Number(btn.closest("[data-idx]").dataset.idx);
    r[tbl].splice(idx, 1); saveToStorage(); renderMain();
  }));
  const actions = {
    addFermentable: () => r.fermentables.push({ name: FERMENTABLES[0].name, type: FERMENTABLES[0].type, amountLb: 1, ppg: FERMENTABLES[0].ppg, color: FERMENTABLES[0].srm, mashable: FERMENTABLES[0].mashable, cost: 0 }),
    addHop: () => r.hops.push({ name: HOPS[0].name, amountOz: 1, alphaPct: HOPS[0].alpha, timeMin: 60, use: "Boil", cost: 0 }),
    addMisc: () => r.misc.push({ name: "Whirlfloc Tablet", amount: 1, unit: "tablet", use: "Boil", cost: 0 }),
    addSalt: () => r.waterSalts.push({ name: Object.keys(WATER_SALTS)[0], grams: 1 }),
    addMashStep: () => r.mashSteps.push({ name: "Mash Out", temp: 168, time: 10 }),
    startBatchFromRecipe: () => { const b = newBatch(r.id); state.batches.push(b); state.activeBatchId = b.id; state.activeSection = "batches"; saveToStorage(); renderAll(); },
  };
  panel.querySelectorAll("[data-action]").forEach(btn => { const fn = actions[btn.dataset.action]; if (fn) btn.addEventListener("click", () => { fn(); saveToStorage(); if (state.activeSection === "recipes") renderMain(); else renderAll(); }); });
  panel.querySelectorAll(".history-row").forEach(row => row.addEventListener("click", () => { state.activeBatchId = row.dataset.batchId; state.activeSection = "batches"; saveToStorage(); renderAll(); }));

  const yeastName = panel.querySelector('[data-field="yeastName"]');
  if (yeastName) yeastName.addEventListener("input", () => {
    r.yeast.name = yeastName.value;
    const match = YEASTS.find(y => y.name.toLowerCase() === yeastName.value.toLowerCase());
    if (match) { r.yeast.attenuation = match.attenuation; r.yeast.type = match.type; }
    saveToStorage();
    if (match) renderMain(); else refreshComputed(r);
  });
  const yeastAtt = panel.querySelector('[data-field="yeastAttenuation"]');
  if (yeastAtt) yeastAtt.addEventListener("input", () => { r.yeast.attenuation = Number(yeastAtt.value) / 100; saveToStorage(); refreshComputed(r); });
  const yeastCost = panel.querySelector('[data-field="yeastCost"]');
  if (yeastCost) yeastCost.addEventListener("input", () => { r.yeast.cost = Number(yeastCost.value); saveToStorage(); refreshComputed(r); });

  const equipSel = panel.querySelector('[data-field="equipmentId"]');
  if (equipSel) equipSel.addEventListener("change", () => {
    r.equipmentId = equipSel.value || null;
    const eq = equipmentRef(r.equipmentId);
    if (eq) { r.batchVolGal = eq.batchVolGal; r.boilTimeMin = eq.boilTimeMin; r.efficiencyPct = eq.mashEfficiencyPct; r.waterVolGal = eq.batchVolGal + eq.trubLossGal + (eq.boilOffRateGalHr * eq.boilTimeMin / 60); }
    saveToStorage(); renderMain();
    if (eq) toast('Applied "' + eq.name + '" equipment defaults');
  });
  const styleSel = panel.querySelector('[data-field="styleName"]');
  if (styleSel) styleSel.addEventListener("change", () => { r.styleName = styleSel.value; saveToStorage(); renderMain(); });
  const mashProfileSel = panel.querySelector('[data-field="mashProfileName"]');
  if (mashProfileSel) mashProfileSel.addEventListener("change", () => { r.mashProfileName = mashProfileSel.value; r.mashSteps = JSON.parse(JSON.stringify(MASH_PROFILES[r.mashProfileName])); saveToStorage(); renderMain(); });
  const targetSel = document.getElementById("targetProfileSelect");
  if (targetSel) targetSel.addEventListener("change", () => { r.waterTarget = targetSel.value; r.waterSalts = []; r.waterBase = Object.assign({}, WATER_TARGET_PROFILES[targetSel.value]); saveToStorage(); renderMain(); toast("Matched to " + targetSel.value + " profile"); });
}

function setField(r, path, val) { if (path.indexOf(".") !== -1) { const parts = path.split("."); r[parts[0]][parts[1]] = val; } else r[path] = val; }

function refreshComputed(r) {
  const d = computeDerived(r);
  const style = styleRef(r.styleName);
  const stripHolder = document.querySelector(".gauge-strip");
  if (stripHolder) stripHolder.outerHTML = renderGaugeStrip(d, style);
  if (state.activeTab === "design") {
    const headers = Array.from(document.querySelectorAll(".card h3")).filter(h => h.textContent.indexOf("Style Guide") === 0);
    if (headers[0]) headers[0].closest(".card").innerHTML = '<h3>Style Guide Comparison</h3>' + (style ? styleCompareHtml(r, style) : '<p style="color:var(--ink-faint);font-size:13px;">Pick a style above to compare.</p>');
  }
  if (state.activeTab === "water") {
    document.querySelectorAll(".ion-value").forEach((el, i) => { const ion = ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"][i]; if (ion) el.textContent = Math.round(d.finalWater[ion]); });
    const stats = document.querySelectorAll(".stat-value");
    if (stats[0]) stats[0].textContent = d.ra.toFixed(1) + " ppm as CaCO3";
    if (stats[1]) stats[1].textContent = (isFinite(d.soCl) ? d.soCl.toFixed(2) : "\u2014") + " (" + soClDescription(d.soCl) + ")";
  }
  renderSidebar();
}

function handleNewRecipe() {
  const r = newRecipe();
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
    '<div class="recipe-header"><h1 class="display" style="margin:0;font-size:28px;">' + escapeHtml(b.recipeName) + '</h1><div class="header-actions"><button class="btn btn-sm btn-danger" id="deleteBatchBtn">Delete Batch</button></div></div>' +
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
function renderInventoryMain(main) {
  main.innerHTML = '<div class="recipe-header"><h1 class="display" style="margin:0;font-size:28px;">Inventory</h1></div>' +
    INVENTORY_KINDS.map(pair => {
      const kind = pair[0], label = pair[1];
      const rows = state.inventory[kind].length ? state.inventory[kind].map((item, i) =>
        '<tr data-kind="' + kind + '" data-idx="' + i + '">' +
        '<td><input data-ifield="name" value="' + escapeHtml(item.name) + '"/></td>' +
        '<td><input type="number" step="0.1" data-ifield="stock" value="' + item.stock + '" style="' + (item.stock <= 0 ? "color:var(--alert);" : "") + '"/></td>' +
        '<td><select data-ifield="unit">' + ["kg", "g", "lb", "oz", "pkg", "tablet", "item"].map(u => '<option ' + (item.unit === u ? "selected" : "") + '>' + u + '</option>').join("") + '</select></td>' +
        '<td><input type="number" step="0.01" data-ifield="cost" value="' + item.cost + '"/></td>' +
        '<td><button class="del-btn" data-del-inv="' + kind + '">\u2715</button></td></tr>'
      ).join("") : '<tr class="empty-row"><td colspan="5">Nothing tracked yet</td></tr>';
      return '<div class="card"><h3>' + label + ' <button class="btn btn-sm" data-add-kind="' + kind + '">+ Add Item</button></h3>' +
        '<table class="ing-table"><thead><tr><th style="width:36%">Name</th><th>Stock</th><th>Unit</th><th>Cost / unit ($)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }).join("");
  main.querySelectorAll("[data-add-kind]").forEach(btn => btn.addEventListener("click", () => { state.inventory[btn.dataset.addKind].push(newInventoryItem(btn.dataset.addKind)); saveToStorage(); renderMain(); }));
  main.querySelectorAll("[data-ifield]").forEach(el => el.addEventListener("input", () => {
    const row = el.closest("[data-kind]"); const kind = row.dataset.kind, idx = Number(row.dataset.idx);
    const val = el.type === "number" ? Number(el.value) : el.value;
    state.inventory[kind][idx][el.dataset.ifield] = val; saveToStorage();
  }));
  main.querySelectorAll("[data-del-inv]").forEach(btn => btn.addEventListener("click", () => { const row = btn.closest("[data-kind]"); state.inventory[btn.dataset.delInv].splice(Number(row.dataset.idx), 1); saveToStorage(); renderMain(); }));
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
  if (!state.unitSystem) state.unitSystem = "metric";
  Tree.pruneOrphans(state.tree, new Set(state.recipes.map(r => r.id)));
  saveToStorage();
  renderAll();
  updateUnitToggleLabel();
  checkIncomingShare();

  document.getElementById("newRecipeBtn").addEventListener("click", () => { if (state.activeSection === "recipes") handleNewRecipe(); else if (state.activeSection === "batches") handleNewBatch(); });
  document.getElementById("newFolderBtn").addEventListener("click", () => { state.tree.children.push(Tree.createFolder("New Folder")); saveToStorage(); renderSidebar(); });
  document.getElementById("exportAllBtn").addEventListener("click", exportAll);
  document.getElementById("importInput").addEventListener("change", e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; });
  document.getElementById("unitToggleBtn").addEventListener("click", () => { state.unitSystem = state.unitSystem === "metric" ? "us" : "metric"; saveToStorage(); updateUnitToggleLabel(); renderAll(); });
}
function updateUnitToggleLabel() { document.getElementById("unitToggleBtn").textContent = state.unitSystem === "metric" ? "Units: Metric" : "Units: Imperial"; }

document.addEventListener("DOMContentLoaded", init);
