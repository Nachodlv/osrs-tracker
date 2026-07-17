// --- Edge retargeting -----------------------------------------------------------
// Drag either end of an edge (a handle at the parent end and one at the child
// end) onto another node to make that node the child's parent instead. The
// child end stays anchored (x1, y1); only the parent target changes.

function startEdgeRetarget(e, childId, oldParentId, svg, handle, x1, y1) {
  e.preventDefault();
  e.stopPropagation();
  handle.style.pointerEvents = "none"; // keep elementFromPoint seeing what's underneath

  const temp = document.createElementNS(SVG_NS, "path");
  temp.setAttribute("class", "edge edge-retarget");
  svg.appendChild(temp);

  let hoverCard = null;
  function cardAt(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    return el && el.closest ? el.closest(".graph-node") : null;
  }

  function move(ev) {
    const rect = svg.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const dx = Math.max(40, (x - x1) / 2);
    temp.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x - dx},${y} ${x},${y}`);
    const card = cardAt(ev);
    if (card !== hoverCard) {
      if (hoverCard) hoverCard.classList.remove("retarget-target");
      hoverCard = card;
      if (hoverCard && hoverCard.dataset.id !== childId && hoverCard.dataset.id !== oldParentId) {
        hoverCard.classList.add("retarget-target");
      }
    }
  }

  function up(ev) {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    temp.remove();
    if (hoverCard) hoverCard.classList.remove("retarget-target");
    const card = cardAt(ev);
    if (card && card.dataset.id) reparentNode(childId, oldParentId, card.dataset.id);
    else render(); // restore the handle
  }

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

function reparentNode(childId, oldParentId, newParentId) {
  if (!childId || !newParentId || newParentId === oldParentId || newParentId === childId) { render(); return; }
  if (!currentNodes[newParentId] || !currentNodes[childId]) { render(); return; }
  if (isAncestor(childId, newParentId, currentNodes)) {
    showToast("Can't move that arrow there — it would create a loop.");
    render();
    return;
  }

  withUndo("Moved goal", () => {
    const custom = state.customNodes[childId];
    const linked = state.linkedEdges[oldParentId];
    const hadManualLink = !!(linked && linked.includes(childId));
    // Strip any manual link duplicating the old parent edge, so this is a
    // clean move rather than leaving the old connection behind (a node can
    // carry both a custom.parentId and a linkedEdge to the same parent).
    if (hadManualLink) {
      state.linkedEdges[oldParentId] = linked.filter(x => x !== childId);
      if (!state.linkedEdges[oldParentId].length) delete state.linkedEdges[oldParentId];
    }
    if (custom && custom.parentId === oldParentId) {
      custom.parentId = newParentId;
    } else {
      // Not the custom primary edge. If it wasn't a manual link either, it's a
      // built-in tree edge, so record the detachment. Then attach the new edge.
      if (!hadManualLink) {
        if (!state.removedEdges[oldParentId]) state.removedEdges[oldParentId] = [];
        if (!state.removedEdges[oldParentId].includes(childId)) state.removedEdges[oldParentId].push(childId);
      }
      addToLinkedEdges(newParentId, childId);
    }

    state.collapsed[newParentId] = false;
    saveState();
    render();
  });
}

function addToLinkedEdges(parentId, childId) {
  if (!state.linkedEdges[parentId]) state.linkedEdges[parentId] = [];
  if (!state.linkedEdges[parentId].includes(childId)) state.linkedEdges[parentId].push(childId);
  // It has a parent again, so it's no longer a promoted standalone root.
  if (state.rootGoals) delete state.rootGoals[childId];
}

// Removes the edge parentId -> childId, whichever mechanism created it: a
// custom node's primary parent link, a manually linked edge, or a built-in
// tree edge (recorded as a detachment). Mirrors reparentNode's branching.
function detachEdge(parentId, childId) {
  withUndo("Removed link", () => {
    const custom = state.customNodes[childId];
    const linked = state.linkedEdges[parentId];
    if (custom && custom.parentId === parentId) {
      custom.parentId = null;
    } else if (linked && linked.includes(childId)) {
      state.linkedEdges[parentId] = linked.filter(x => x !== childId);
      if (!state.linkedEdges[parentId].length) delete state.linkedEdges[parentId];
    } else {
      if (!state.removedEdges[parentId]) state.removedEdges[parentId] = [];
      if (!state.removedEdges[parentId].includes(childId)) state.removedEdges[parentId].push(childId);
    }
    // If this was the child's last parent, keep it as a standalone top-level
    // goal rather than letting pruneRemoved cascade it away.
    const child = currentNodes[childId];
    const remaining = child ? child.parentIds.filter(p => p !== parentId) : [];
    if (!remaining.length) state.rootGoals[childId] = true;
    saveState();
    render();
  });
}

// --- Right-click context menu --------------------------------------------------

let contextMenuEl = null;

function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function openContextMenu(x, y, node, info) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";

  function addItem(label, onClick, disabled) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "context-menu-item";
    item.textContent = label;
    if (disabled) {
      item.disabled = true;
    } else {
      item.addEventListener("click", () => { closeContextMenu(); onClick(); });
    }
    menu.appendChild(item);
    return item;
  }

  if (info.hasChildren) {
    addItem(isExpandedState(node.id) ? "Collapse" : "Expand", () => toggleCollapse(node.id));
  }

  if (info.status === "done") {
    addItem("Mark as not done", () => markDone(node.id, false));
  } else if (isAutoTrackedSkill(node)) {
    addItem("Tracked automatically from hiscores", null, true);
  } else if (!info.canToggleDone) {
    addItem("Locked until sub-goals are done", null, true);
  } else {
    addItem("Mark complete", () => markDone(node.id, true));
  }

  if (node.link) {
    addItem("Open wiki link ↗", () => window.open(node.link, "_blank", "noopener"));
  }

  const isGroupedRoot = node.parentIds.length === 0 && getGroupOf(node.id) !== null;
  if (!isGroupedRoot) {
    addItem("Move up", () => moveNode(node.id, -1));
    addItem("Move down", () => moveNode(node.id, 1));
  } else {
    addItem("Remove from group", () => { removeFromGroup(node.id); saveState(); render(); });
  }

  addItem("Add sub-goal…", () => openAddGoalModal(node.id));
  addItem("Open / Edit…", () => openEditGoalModal(node.id));
  addItem("Delete", () => removeGoal(node.id));

  mountContextMenu(menu, x, y);
}

// Positions a built menu at (x, y), clamped into the viewport, and wires the
// click-away close.
function mountContextMenu(menu, x, y) {
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  contextMenuEl = menu;
  setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 0);
}

// Right-clicking empty chart space offers to create a top-level goal.
function openBackgroundContextMenu(x, y) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  const item = document.createElement("button");
  item.type = "button";
  item.className = "context-menu-item";
  item.textContent = "New goal…";
  item.addEventListener("click", () => { closeContextMenu(); openAddGoalModal(null); });
  menu.appendChild(item);
  mountContextMenu(menu, x, y);
}

document.addEventListener("contextmenu", e => {
  if (e.target.closest(".graph-node")) return; // handled by the card's own contextmenu
  if (e.target.closest("#chart")) {
    e.preventDefault();
    openBackgroundContextMenu(e.clientX, e.clientY);
  } else {
    closeContextMenu();
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeContextMenu(); });
