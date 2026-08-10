
// --- Tier groups (drag & drop) --------------------------------------------------
// state.groupsState = { groupOrder: [gid...], groups: { gid: [id...] } }. Lazily
// seeded from GEAR_GROUPS, then user-editable like any other state.
function ensureGroupsState() {
  if (state.groupsState) return;
  const groupOrder = [];
  const groups = {};
  (typeof GEAR_GROUPS !== "undefined" ? GEAR_GROUPS : []).forEach((g, i) => {
    const members = g.filter(id => currentNodes[id]);
    if (members.length) {
      const gid = "g" + i;
      groups[gid] = members;
      groupOrder.push(gid);
    }
  });
  state.groupsState = { groupOrder, groups };
}

function getGroupOf(id) {
  const gs = state.groupsState;
  if (!gs) return null;
  for (const gid of gs.groupOrder) {
    if (gs.groups[gid] && gs.groups[gid].indexOf(id) !== -1) return gid;
  }
  return null;
}

// A group that drops to one or zero members is dissolved.
function removeFromGroup(id) {
  const gid = getGroupOf(id);
  if (!gid) return;
  const gs = state.groupsState;
  gs.groups[gid] = gs.groups[gid].filter(x => x !== id);
  if (gs.groups[gid].length <= 1) {
    delete gs.groups[gid];
    gs.groupOrder = gs.groupOrder.filter(x => x !== gid);
  }
}

// Dropping sourceId onto targetId: joins targetId's group (inserted before it),
// or creates a new group of the two if targetId is ungrouped.
function handleGroupDrop(sourceId, targetId) {
  withUndo("Grouped goal", () => {
    ensureGroupsState();
    if (!sourceId || sourceId === targetId || !currentNodes[sourceId] || !currentNodes[targetId]) return;
    const targetGroup = getGroupOf(targetId);
    removeFromGroup(sourceId);
    if (targetGroup) {
      const arr = state.groupsState.groups[targetGroup];
      const idx = arr.indexOf(targetId);
      arr.splice(idx, 0, sourceId);
    } else {
      const newId = "c" + Date.now();
      state.groupsState.groups[newId] = [targetId, sourceId];
      state.groupsState.groupOrder.push(newId);
    }
    saveState();
    render();
  });
}

// Dropping onto a group's empty background appends to the end of that group.
function handleDropOnGroup(sourceId, groupId) {
  withUndo("Grouped goal", () => {
    ensureGroupsState();
    if (!sourceId || !currentNodes[sourceId] || !state.groupsState.groups[groupId]) return;
    removeFromGroup(sourceId);
    state.groupsState.groups[groupId].push(sourceId);
    saveState();
    render();
  });
}

// Dropping onto open background ungroups.
function handleDropOnBackground(sourceId) {
  withUndo("Ungrouped goal", () => {
    ensureGroupsState();
    if (!sourceId || !currentNodes[sourceId]) return;
    if (!getGroupOf(sourceId)) return;
    removeFromGroup(sourceId);
    saveState();
    render();
  });
}

let dragSourceRootId = null;
let dragSourceChildId = null;
let dragGhostEl = null;
let pendingChildOrder = null;

// Removes the drag-preview ghost and any sibling nudges, if any.
function clearDragPreview() {
  if (dragGhostEl && dragGhostEl.parentNode) dragGhostEl.remove();
  dragGhostEl = null;
  dragChildLastSig = null;
  pendingChildOrder = null;
  dragRootLastSig = null;
  pendingRootDrop = null;
  dragGroupLastSig = null;
  pendingGroupDrop = null;
  document.querySelectorAll(".graph-node.drag-shift").forEach(el => {
    el.classList.remove("drag-shift");
    el.style.transform = "";
  });
  document.querySelectorAll(".graph-node.drag-source-hidden").forEach(el => {
    el.classList.remove("drag-source-hidden");
  });
}

// The ghost is always an overlay (fixed positioning, pointer-events: none),
// never inserted into the real card layout. Native HTML5 drag & drop
// retargets dragover/dragenter by hit-testing whatever's under the cursor on
// every move, so nudging a real (interactive) sibling out of the way pulls it
// out from under the cursor mid-drag; the browser then treats the next
// dragover as an invalid target and snaps the drag back on release. Keeping
// the ghost pointer-events:none and off to the side avoids that entirely.
// fullClassName overrides the default icon-shaped ghost (used by group drag).
function makeGhostEl(extraClass, fullClassName) {
  if (!dragGhostEl) {
    dragGhostEl = document.createElement("div");
    dragGhostEl.style.position = "fixed";
  }
  dragGhostEl.className = fullClassName || ("graph-node goal-ghost" + (extraClass ? " " + extraClass : ""));
  if (dragGhostEl.parentNode !== document.body) document.body.appendChild(dragGhostEl);
  return dragGhostEl;
}

// Root/tier-group drag. Frozen at dragstart: every compact (collapsed) root
// icon's geometry plus which group it's in, and every group box's geometry.
// Hit testing runs against this snapshot, never the live DOM, so the shift
// the gap preview applies can't feed back into the next target computation.
let dragRootAllRects = null;   // [{id, groupId, top,bottom,left,right}]
let dragRootGroupRects = null; // [{groupId, top,bottom,left,right}]
let pendingRootDrop = null;    // the intent the last dragover previewed; committed verbatim on drop
let dragRootLastSig = null;    // dedup so a stationary hover doesn't re-run the preview

function captureRootAllRects() {
  dragRootAllRects = Array.from(document.querySelectorAll(".graph-node.grid-mode[data-id]")).map(el => {
    const r = el.getBoundingClientRect();
    const g = el.closest(".gear-group");
    return { id: el.dataset.id, groupId: g ? g.dataset.groupId : null, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  dragRootGroupRects = Array.from(document.querySelectorAll(".gear-group")).map(g => {
    const r = g.getBoundingClientRect();
    return { groupId: g.dataset.groupId, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
}

function iconRect(id) { return dragRootAllRects && dragRootAllRects.find(r => r.id === id); }
function iconCenter(r) { return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }

// How many of `ids` (excluding source) sit before the cursor in reading order
// (earlier row, or same row and further left). Counting includes the slot the
// source itself currently occupies, so hovering the source's own position
// yields its own index back: a no-move, ghost parked exactly where the icon
// already is. That's the whole point vs. the old "nearest other, insert
// before it" which could never represent "leave it where it is" or "put it
// last" and so jumped the preview the instant a drag began.
function reorderIndexAmong(ids, sourceId, x, y) {
  const first = ids.map(iconRect).find(Boolean);
  const rowT = first ? (first.bottom - first.top) / 2 : 20;
  let idx = 0;
  ids.forEach(id => {
    if (id === sourceId) return;
    const r = iconRect(id); if (!r) return;
    const c = iconCenter(r);
    const before = c.y < y - rowT || (Math.abs(c.y - y) <= rowT && c.x < x);
    if (before) idx++;
  });
  return idx;
}

function nearestIconInGroup(groupId, x, y) {
  let best = null, bestDist = Infinity;
  dragRootAllRects.forEach(r => {
    if (r.groupId !== groupId || r.id === dragSourceRootId) return;
    const c = iconCenter(r);
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < bestDist) { bestDist = d; best = r.id; }
  });
  return best;
}

// A loose (ungrouped) icon the cursor is directly over. Point-in-rect, not
// nearest-within-reach: forming a new group means deliberately dropping one
// icon onto another, and keeping this strict is what leaves the surrounding
// empty background free to mean "ungroup" instead of greedily pairing with
// whatever loose icon happens to be within reach.
function looseIconAt(x, y) {
  const r = (dragRootAllRects || []).find(rr =>
    !rr.groupId && rr.id !== dragSourceRootId &&
    x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom);
  return r ? r.id : null;
}

function groupBoxAt(x, y) {
  return (dragRootGroupRects || []).find(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) || null;
}

// Builds an "insert into group" intent (same-group reorder or cross-group
// join). previewCollapsed is the icon sequence, source included, that the gap
// preview lays out into the group's slots. The commit differs: same-group
// rewrites the whole member order; cross-group inserts before a member (or
// appends), which handleGroupDrop / handleDropOnGroup already do.
function insertIntoGroupAction(groupId, x, y, sameGroup) {
  const members = state.groupsState.groups[groupId] || [];
  const iconMembers = members.filter(id => iconRect(id));
  const idx = reorderIndexAmong(iconMembers, dragSourceRootId, x, y);
  const previewCollapsed = iconMembers.filter(id => id !== dragSourceRootId);
  previewCollapsed.splice(idx, 0, dragSourceRootId);
  if (sameGroup) {
    // Reconstruct the full member order, leaving any expanded (non-icon)
    // members in their original slots and filling icon slots in new order.
    let k = 0;
    const order = members.map(id => iconRect(id) ? previewCollapsed[k++] : id);
    return { type: "insert", groupId, previewCollapsed, sameGroup: true, order };
  }
  const beforeId = idx < iconMembers.length ? iconMembers[idx] : null;
  return { type: "insert", groupId, previewCollapsed, sameGroup: false, beforeId };
}

// Resolves the drop intent for the current cursor position against frozen
// geometry. Returns null when nothing applies (drop then does nothing).
function resolveRootDrag(x, y) {
  const srcGroup = getGroupOf(dragSourceRootId);
  // Inside the source's own group -> reorder within it (the gap-opening case).
  if (srcGroup && iconRect(dragSourceRootId)) {
    const box = (dragRootGroupRects || []).find(b => b.groupId === srcGroup);
    if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      return insertIntoGroupAction(srcGroup, x, y, true);
    }
  }
  // Over a different group -> insert into it, with the same gap preview.
  const box = groupBoxAt(x, y);
  if (box && box.groupId !== srcGroup) {
    return insertIntoGroupAction(box.groupId, x, y, false);
  }
  // Directly over a loose (ungrouped) icon -> form a new group with it.
  const loose = looseIconAt(x, y);
  if (loose) return { type: "group", targetId: loose };
  // Open background -> ungroup (only meaningful if the source is grouped).
  if (srcGroup) return { type: "ungroup" };
  return null;
}

function applyRootPreview(action) {
  const sig = JSON.stringify(action);
  if (sig === dragRootLastSig) return;
  dragRootLastSig = sig;

  document.querySelectorAll(".graph-node.drag-shift").forEach(el => {
    el.classList.remove("drag-shift");
    el.style.transform = "";
  });
  document.querySelectorAll(".graph-node.drag-source-hidden").forEach(el => {
    el.classList.remove("drag-source-hidden");
  });

  const ghost = makeGhostEl("compact-node");

  if (action.type === "insert") {
    // Same-group only: the source icon stays put at reduced opacity during a
    // native drag and a sibling shifts into its slot, so hide it to avoid the
    // overlap. Cross-group leaves the source's origin card alone.
    if (action.sameGroup) {
      const sourceEl = findGraphNodeEl(document, dragSourceRootId);
      if (sourceEl) sourceEl.classList.add("drag-source-hidden");
    }
    // slots[i] = the position of the i-th icon in the group's original order.
    const iconMembers = (state.groupsState.groups[action.groupId] || []).filter(id => iconRect(id));
    const slots = iconMembers.map(iconRect);
    // Cross-group grows the group by one, so previewCollapsed needs one more
    // slot than exists; extend along the icon pitch (icons are uniform width).
    while (slots.length && slots.length < action.previewCollapsed.length) {
      const n = slots.length, last = slots[n - 1];
      const pitch = (n >= 2 && slots[n - 1].top === slots[n - 2].top) ? slots[n - 1].left - slots[n - 2].left : 68;
      slots.push({ left: last.left + pitch, top: last.top });
    }
    if (!slots.length) { // group with no visible icons: park the ghost in its box
      const box = (dragRootGroupRects || []).find(b => b.groupId === action.groupId);
      slots.push({ left: (box ? box.left + 8 : 20), top: (box ? box.top + 8 : 20) });
    }
    action.previewCollapsed.forEach((id, i) => {
      const slot = slots[i];
      if (id === dragSourceRootId) {
        ghost.style.left = slot.left + "px";
        ghost.style.top = slot.top + "px";
        return;
      }
      const orig = iconRect(id);
      if (!orig) return;
      const dx = slot.left - orig.left, dy = slot.top - orig.top;
      if (!dx && !dy) return;
      const el = findGraphNodeEl(document, id);
      if (el) {
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.classList.add("drag-shift");
      }
    });
  } else if (action.type === "group") {
    const r = iconRect(action.targetId);
    ghost.style.left = (r.right + 6) + "px";
    ghost.style.top = r.top + "px";
  } else { // ungroup: no fixed slot, so just mark the drop point
    ghost.style.left = "20px";
    ghost.style.top = "20px";
  }
}

function applyGroupOrder(groupId, order) {
  withUndo("Moved goal", () => {
    ensureGroupsState();
    if (!state.groupsState.groups[groupId]) return;
    state.groupsState.groups[groupId] = order;
    saveState();
    render();
  });
}

document.addEventListener("dragover", e => {
  if (!dragSourceRootId) return;
  const action = resolveRootDrag(e.clientX, e.clientY);
  if (!action) { pendingRootDrop = null; return; }
  e.preventDefault();
  pendingRootDrop = action;
  applyRootPreview(action);
});

// Commit exactly what the last dragover previewed, rather than re-hit-testing
// the release point: the visible icons have shifted, so a fresh hit-test
// against frozen geometry could disagree with the ghost the user is looking
// at. What you see is what you get.
document.addEventListener("drop", e => {
  if (!dragSourceRootId || !pendingRootDrop) return;
  e.preventDefault();
  const src = dragSourceRootId, action = pendingRootDrop;
  clearDragPreview();
  if (action.type === "insert") {
    if (action.sameGroup) applyGroupOrder(action.groupId, action.order);
    else if (action.beforeId) handleGroupDrop(src, action.beforeId);
    else handleDropOnGroup(src, action.groupId);
  } else if (action.type === "group") handleGroupDrop(src, action.targetId);
  else if (action.type === "ungroup") handleDropOnBackground(src);
});

// --- Whole-group reorder (drag the grip) --------------------------------------
// Same frozen-geometry / commit-the-preview tech as the icon and child drags,
// scaled up to the tier-group boxes: freeze every group box at dragstart, and
// hit-test the cursor against that snapshot. Groups vary in width and wrap
// across rows, so instead of physically shifting dozens of boxes the preview
// is a slim insertion bar marking the gap the group will drop into.
let dragSourceGroupId = null;
let dragGroupRects = null;
let pendingGroupDrop = null; // the new visible group order the last dragover previewed
let dragGroupLastSig = null;

function captureGroupRects() {
  dragGroupRects = Array.from(document.querySelectorAll(".gear-group")).map(el => {
    const r = el.getBoundingClientRect();
    return { groupId: el.dataset.groupId, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
}

// Nearest insertion gap among the other group boxes (source excluded), in
// their current order. Gap k sits before others[k], or after the last box
// when k === others.length.
function groupInsertIndexAt(x, y, others) {
  let bestIdx = 0, bestDist = Infinity;
  for (let k = 0; k <= others.length; k++) {
    const ref = k < others.length ? others[k] : others[others.length - 1];
    const gx = k < others.length ? ref.left : ref.right;
    const gy = (ref.top + ref.bottom) / 2;
    const d = Math.hypot(x - gx, y - gy);
    if (d < bestDist) { bestDist = d; bestIdx = k; }
  }
  return bestIdx;
}

function showGroupGhost(idx, others) {
  const sig = "g" + idx;
  if (sig === dragGroupLastSig) return;
  dragGroupLastSig = sig;
  const ghost = makeGhostEl(null, "group-ghost");
  const atEnd = idx >= others.length;
  const ref = atEnd ? others[others.length - 1] : others[idx];
  ghost.style.left = (atEnd ? ref.right + 4 : ref.left - 10) + "px";
  ghost.style.top = ref.top + "px";
  ghost.style.width = "6px";
  ghost.style.height = (ref.bottom - ref.top) + "px";
}

function commitGroupReorder(newVisibleOrder) {
  withUndo("Moved group", () => {
    ensureGroupsState();
    const gs = state.groupsState;
    const visibleSet = new Set(newVisibleOrder);
    let k = 0;
    // Rewrite only the visible groups' slots in groupOrder, leaving any
    // filtered-out (hidden) groups pinned where they are.
    gs.groupOrder = gs.groupOrder.map(gid => visibleSet.has(gid) ? newVisibleOrder[k++] : gid);
    saveState();
    render();
  });
}

document.addEventListener("dragover", e => {
  if (!dragSourceGroupId || !dragGroupRects) return;
  const others = dragGroupRects.filter(g => g.groupId !== dragSourceGroupId);
  if (!others.length) return;
  const idx = groupInsertIndexAt(e.clientX, e.clientY, others);
  e.preventDefault();
  const order = others.map(g => g.groupId);
  order.splice(idx, 0, dragSourceGroupId);
  pendingGroupDrop = order;
  showGroupGhost(idx, others);
});

document.addEventListener("drop", e => {
  if (!dragSourceGroupId || !pendingGroupDrop) return;
  e.preventDefault();
  const order = pendingGroupDrop;
  clearDragPreview();
  commitGroupReorder(order);
});

function findGraphNodeEl(container, id) {
  return Array.from(container.querySelectorAll(".graph-node")).find(el => el.dataset.id === id) || null;
}

// The row each column sibling lands on given an explicit new order, mirroring
// computeRows' gap-preserving assignment (order decides sequence; rows still
// snap toward the child average). A node with children can justifiably snap
// toward their average row, which keeps a parent level with its children
// after a reorder. A childless node has no such anchor, so it just takes the
// next open row rather than being dragged back toward its old position.
function previewChildRows(order) {
  const desired = {};
  order.forEach(id => {
    const childRows = (currentNodes[id].childIds || []).map(cid => lastRows[cid]).filter(r => r != null);
    desired[id] = childRows.length ? childRows.reduce((a, b) => a + b, 0) / childRows.length : null;
  });
  const rows = {};
  let nextRow = 0;
  order.forEach(id => {
    const r = desired[id] != null ? Math.max(nextRow, Math.round(desired[id])) : nextRow;
    rows[id] = r;
    nextRow = r + 1;
  });
  return rows;
}

// The order the last preview ran for, so a stationary hover doesn't re-run it.
let dragChildLastSig = null;

// Child (expanded) reorder drag: show the ghost at its landing slot and nudge
// bumped siblings (real cards) out of the way so the drop result is obvious
// before release. The siblings physically move here, safe only because
// retargeting no longer depends on any single card's own dragover listener
// staying under the cursor; the document-level listeners hit-test against a
// frozen snapshot instead of the live DOM.
function showChildReorderGhost(order) {
  // dragover fires continuously (many times a second) for as long as the
  // cursor sits still, not just when the resolved order changes. Redoing the
  // clear-then-reapply-transform dance on every tick, with a
  // getBoundingClientRect() read forcing a layout flush in between, restarted
  // the CSS transition from zero each time, which read as the shifted cards
  // visibly vibrating. Skipping the no-op case is what actually fixes it.
  const sig = order.join(",");
  if (sig === dragChildLastSig) return;
  dragChildLastSig = sig;

  const canvas = dragChildCanvas;
  if (!canvas) return;
  const rows = previewChildRows(order);

  document.querySelectorAll(".graph-node.drag-shift").forEach(el => {
    el.classList.remove("drag-shift");
    el.style.transform = "";
  });

  // The dragged card's own placeholder stays at its old (unshifted) spot; once
  // a sibling shift preview is active, a bumped sibling can slide into that
  // exact spot and overlap it. The ghost already shows where it's landing, so
  // hide the stale placeholder rather than let the two overlap.
  const sourceEl = findGraphNodeEl(canvas, dragSourceChildId);
  if (sourceEl) sourceEl.classList.add("drag-source-hidden");

  const ghost = makeGhostEl();
  const canvasRect = canvas.getBoundingClientRect();
  const col = lastColumns[dragSourceChildId];
  ghost.style.left = (canvasRect.left + col * COL_W + PAD) + "px";
  // Rows are not on a fixed pitch once a node's footer wraps, so ask the
  // renderer where each row actually starts.
  const block = lastNodeBlock[dragSourceChildId];
  ghost.style.top = (canvasRect.top + rowTopIn(block, rows[dragSourceChildId])) + "px";

  Object.keys(rows).forEach(id => {
    if (id === dragSourceChildId) return;
    if (rows[id] === lastRows[id]) return;
    const el = findGraphNodeEl(canvas, id);
    if (el) {
      const delta = rowTopIn(lastNodeBlock[id], rows[id]) - rowTopIn(lastNodeBlock[id], lastRows[id]);
      el.style.transform = `translateY(${delta}px)`;
      el.classList.add("drag-shift");
    }
  });
}

// Column-sibling geometry frozen at dragstart, before anything shifts, scoped
// to the exact .chain-canvas the dragged card lives in (via its own DOM
// position, not columnSiblings()/lastColumns/lastNodeBlock). Those globals
// hold one value per node id, but any node visible through more than one
// expanded root at once — every `shared:` id in data.js, or anything reached
// via a linkedEdge — renders once per root block, and whichever root
// happened to render last wins the id's entry. Trusting them here could
// resolve "siblings" from a completely different block than the one actually
// being dragged in, silently reordering the wrong cards (or finding no
// siblings at all, making the drag look permanently invalid). Reading
// straight off the DOM within the card's own canvas sidesteps that entirely.
//
// Hit testing during the drag is also done against this frozen snapshot,
// never the live DOM — using elementFromPoint (or any other live lookup)
// instead would read back positions the drag-shift preview itself just
// moved, feeding the shift into the next target computation and compounding
// without bound (each tick nudging things further).
let dragChildCanvas = null;
let dragChildSiblingRects = null;

function captureChildSiblingRects(sourceId, sourceEl) {
  dragChildCanvas = sourceEl.closest(".chain-canvas");
  if (!dragChildCanvas) { dragChildSiblingRects = null; return; }
  const col = sourceEl.style.left;
  dragChildSiblingRects = Array.from(dragChildCanvas.querySelectorAll(".graph-node[data-id]"))
    .filter(el => el.style.left === col)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    })
    .sort((a, b) => a.top - b.top); // visual row order, so .map(s=>s.id) is a usable column order
}

// Reading-order insertion index for the dragged card among its frozen column
// siblings: how many sit above the cursor. Counting the source's own slot
// (it's skipped, but every sibling above it is counted) means hovering the
// source's original position yields its own index back: a no-move, ghost
// parked where the card already is. Same reasoning as reorderIndexAmong for
// the collapsed icons: "insert before nearest other" could never represent
// "leave it here" or "put it last", which is what made the old preview jump
// the instant a drag began.
function childReorderIndex(x, y) {
  if (!dragChildSiblingRects || !dragChildSiblingRects.length) return null;
  const col = dragChildSiblingRects[0];
  if (x < col.left - 40 || x > col.right + 40) return null;
  let idx = 0;
  dragChildSiblingRects.forEach(s => {
    if (s.id === dragSourceChildId) return;
    if ((s.top + s.bottom) / 2 < y) idx++;
  });
  return idx;
}

// The column order the dragged card would produce if dropped at the current
// cursor position: siblings in row order with the source spliced in at its
// reading-order index. Null when the cursor is outside the column band.
function childReorderOrderAt(x, y) {
  const idx = childReorderIndex(x, y);
  if (idx == null) return null;
  const order = dragChildSiblingRects.map(s => s.id).filter(id => id !== dragSourceChildId);
  order.splice(idx, 0, dragSourceChildId);
  return order;
}

document.addEventListener("dragover", e => {
  if (!dragSourceChildId) return;
  const order = childReorderOrderAt(e.clientX, e.clientY);
  if (!order) return;
  e.preventDefault();
  pendingChildOrder = order;
  showChildReorderGhost(order);
});

// Commit exactly the previewed order rather than re-hit-testing the release
// point: the visible cards have shifted, so a fresh hit-test against frozen
// geometry could disagree with the ghost the user is looking at.
document.addEventListener("drop", e => {
  if (!dragSourceChildId || !pendingChildOrder) return;
  e.preventDefault();
  const order = pendingChildOrder;
  clearDragPreview();
  applyColumnOrder(order);
});

// Sibling ids of `id` within its column/block, in displayed row order.
function columnSiblings(id) {
  return lastVisibleIds
    .filter(x => lastColumns[x] === lastColumns[id] && lastNodeBlock[x] === lastNodeBlock[id])
    .sort((a, b) => lastRows[a] - lastRows[b]);
}

// Persists an explicit order for every sibling in the column, so manual order
// wins over the child-row-average placement in computeRows.
function applyColumnOrder(orderedIds) {
  withUndo("Moved goal", () => {
    orderedIds.forEach((sid, i) => { state.order[sid] = i; });
    saveState();
    render();
  });
}

function moveNode(id, dir) {
  withUndo("Moved goal", () => {
    // Root goals reorder within the overall flow order; non-root nodes reorder
    // among their column siblings within the same root's block.
    const isRoot = currentNodes[id] && currentNodes[id].parentIds.length === 0;
    if (isRoot) {
      const siblings = lastRootOrder;
      const idx = siblings.indexOf(id);
      if (idx === -1) return; // grouped root: reorder by dragging within the group
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= siblings.length) return;
      const otherId = siblings[swapIdx];
      const a = effectiveOrder(id, lastDiscoveryOrder);
      const b = effectiveOrder(otherId, lastDiscoveryOrder);
      state.order[id] = b;
      state.order[otherId] = a;
      saveState();
      render();
      return;
    }
    const siblings = columnSiblings(id);
    const idx = siblings.indexOf(id);
    if (idx === -1) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const arr = siblings.slice();
    arr.splice(idx, 1);
    arr.splice(swapIdx, 0, id);
    applyColumnOrder(arr);
  });
}

