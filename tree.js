// ---- Tree: pure functions over a nested folder structure ----
// Node shapes:
//   folder: { id, type: "folder", name, notes, expanded, children: [...] }
//   recipe leaf: { id, type: "recipe", recipeId }
// The tree only stores organisation (which folder a recipe lives in); the recipe's
// actual data lives in state.recipes, looked up by recipeId. This keeps moves/renames/
// clones of the tree cheap and keeps recipe data flat and simple to back up.

const Tree = {
  createRoot() {
    return { id: "root", type: "folder", name: "My Recipes", notes: "", expanded: true, children: [] };
  },
  createFolder(name) {
    return { id: uid(), type: "folder", name: name || "New Folder", notes: "", expanded: true, children: [] };
  },
  createLeaf(recipeId) {
    return { id: uid(), type: "recipe", recipeId };
  },

  findNode(node, id) {
    if (node.id === id) return node;
    if (node.type !== "folder") return null;
    for (const child of node.children) {
      const found = this.findNode(child, id);
      if (found) return found;
    }
    return null;
  },

  findParent(node, childId, parent = null) {
    if (node.id === childId) return parent;
    if (node.type !== "folder") return null;
    for (const child of node.children) {
      const found = this.findParent(child, childId, node);
      if (found) return found;
    }
    return null;
  },

  findLeafByRecipeId(node, recipeId) {
    if (node.type === "recipe" && node.recipeId === recipeId) return node;
    if (node.type === "folder") {
      for (const child of node.children) {
        const found = this.findLeafByRecipeId(child, recipeId);
        if (found) return found;
      }
    }
    return null;
  },

  isDescendant(node, ancestorId) {
    const ancestor = this.findNode(node, ancestorId);
    if (!ancestor || ancestor.type !== "folder") return () => false;
    const ids = new Set();
    const collect = n => { ids.add(n.id); if (n.type === "folder") n.children.forEach(collect); };
    collect(ancestor);
    return id => ids.has(id);
  },

  removeNode(root, id) {
    const parent = this.findParent(root, id);
    if (!parent) return null;
    const idx = parent.children.findIndex(c => c.id === id);
    if (idx === -1) return null;
    return parent.children.splice(idx, 1)[0];
  },

  // Move node `id` to become a child of folder `targetFolderId`. Refuses to move a
  // folder into itself or one of its own descendants.
  moveNode(root, id, targetFolderId) {
    if (id === targetFolderId) return false;
    const target = this.findNode(root, targetFolderId);
    if (!target || target.type !== "folder") return false;
    const node = this.findNode(root, id);
    if (!node) return false;
    if (node.type === "folder" && this.isDescendant(root, id)(targetFolderId)) return false; // cycle guard
    const removed = this.removeNode(root, id);
    if (!removed) return false;
    target.children.push(removed);
    return true;
  },

  renameNode(root, id, newName) {
    const node = this.findNode(root, id);
    if (node) node.name = newName;
  },

  // Generate a name that doesn't collide (case-insensitively) with any same-type sibling
  // under `parentNode`. "Recipe" -> "Recipe (2)" -> "Recipe (3)" etc.
  // `nameOf(child)` returns a sibling's display name (tree.js doesn't know about recipe
  // data, so the caller supplies how to resolve a recipe leaf's name).
  // `excludeId` lets a rename check against its own siblings without colliding with itself.
  uniqueSiblingName(parentNode, type, desiredName, nameOf, excludeId) {
    const taken = new Set(
      parentNode.children
        .filter(c => c.type === type && c.id !== excludeId)
        .map(nameOf)
        .filter(n => n != null)
        .map(n => n.toLowerCase())
    );
    if (!taken.has(desiredName.toLowerCase())) return desiredName;
    let i = 2;
    while (taken.has((desiredName + " (" + i + ")").toLowerCase())) i++;
    return desiredName + " (" + i + ")";
  },

  countRecipes(node) {
    if (node.type === "recipe") return 1;
    return node.children.reduce((sum, c) => sum + this.countRecipes(c), 0);
  },

  // Remove any leaves pointing at recipe IDs that no longer exist (defensive cleanup,
  // e.g. after a partial/corrupt import).
  pruneOrphans(node, validRecipeIds) {
    if (node.type !== "folder") return;
    node.children = node.children.filter(c => c.type === "folder" || validRecipeIds.has(c.recipeId));
    node.children.forEach(c => this.pruneOrphans(c, validRecipeIds));
  },
};
