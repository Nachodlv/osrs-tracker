
// --- Graph rendering ---------------------------------------------------------

const chartEl = document.getElementById("chart");
const searchEl = document.getElementById("search");

const IS_MOBILE = window.innerWidth < 700;
const NODE_W = IS_MOBILE ? 160 : 210, NODE_H = IS_MOBILE ? 88 : 96;
const GAP_X = IS_MOBILE ? 50 : 70, GAP_Y = IS_MOBILE ? 16 : 20, PAD = 20;
const COL_W = NODE_W + GAP_X, ROW_H = NODE_H + GAP_Y;
const SVG_NS = "http://www.w3.org/2000/svg";

let currentNodes = {};
let lastColumns = {}, lastRows = {}, lastVisibleIds = [], lastDiscoveryOrder = {}, lastRootOrder = [], lastNodeBlock = {};
let hideCompleted = false, hideIncomplete = false;

function getGraph() {
  const { tree } = getEffectiveTree();
  return buildGraph(tree);
}

// renderUnsafe() builds everything off-screen and swaps it in at the end; this
// wrapper keeps the last good render on screen if anything throws.
function render() {
  try {
    renderTemplateBanner();
    renderUnsafe();
  } catch (e) {
    console.error("Render failed — keeping the previous view instead of going blank:", e);
  }
}

function renderUnsafe() {
  const { nodes, discoveryOrder } = getGraph();
  currentNodes = nodes;
  lastDiscoveryOrder = discoveryOrder;

  const rsnEl = document.getElementById("rsnInput");
  if (rsnEl && document.activeElement !== rsnEl) rsnEl.value = state.username || "";

  // Tier-group members render at top level (in their group box) even if they
  // have also been linked as a child of another goal, so seed them as root-like
  // before computing visibility.
  ensureGroupsState();
  const groupedIdSet = new Set();
  state.groupsState.groupOrder.forEach(gid =>
    (state.groupsState.groups[gid] || []).forEach(id => groupedIdSet.add(id)));

  const visibility = computeVisibility(nodes, groupedIdSet);
  const visibleIds = Object.keys(nodes).filter(id => visibility[id]);
  lastVisibleIds = visibleIds;

  const progressMemo = {};
  const statusMemo = {};
  const mergedColumns = {};
  const mergedRows = {};
  const nodeBlock = {};

  // Every root goal flows together in one wrapping row: collapsed/childless
  // roots are a single small card; expanded ones render their local dependency
  // tree inline, right where that root sits among its siblings.
  const passesHideFilter = id => {
    if (!hideCompleted && !hideIncomplete) return true;
    const p = progressOf(id, nodes, progressMemo);
    const isDone = p.total > 0 && p.completed === p.total;
    if (hideCompleted && isDone) return false;
    if (hideIncomplete && !isDone) return false;
    return true;
  };
  let rootIds = visibleIds.filter(id => nodes[id].parentIds.length === 0 && passesHideFilter(id));
  const rootIdSet = new Set(rootIds);

  function renderRoot(rootId, container) {
    const rootNode = nodes[rootId];
    const isExpanded = rootNode.childIds.length > 0 && isExpandedState(rootId);

    if (!isExpanded) {
      const el = renderGraphNode(rootNode, progressMemo, statusMemo, { compact: true });
      el.classList.add("grid-mode");
      container.appendChild(el);
      return;
    }

    // This root's own local subtree, scoped so collapsing a branch re-packs
    // only this block.
    const sub = {};
    (function visit(id) {
      if (sub[id]) return;
      sub[id] = Object.assign({}, nodes[id], {
        childIds: nodes[id].childIds.filter(cid => visibility[cid])
      });
      nodes[id].childIds.forEach(cid => { if (visibility[cid]) visit(cid); });
    })(rootId);
    const subIds = Object.keys(sub);

    const columns = computeColumns(sub);
    const { rows } = computeRows(sub, columns, discoveryOrder);
    subIds.forEach(id => {
      mergedColumns[id] = columns[id];
      mergedRows[id] = rows[id];
      nodeBlock[id] = rootId;
    });

    const maxCol = Math.max(0, ...subIds.map(id => columns[id]));
    const maxRow = Math.max(0, ...subIds.map(id => rows[id]));
    const width = (maxCol + 1) * COL_W + PAD * 2;
    const height = (maxRow + 1) * ROW_H + PAD * 2;

    const blockEl = document.createElement("div");
    blockEl.className = "chain-canvas";
    blockEl.style.width = width + "px";
    blockEl.style.height = height + "px";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("edge-layer");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.innerHTML =
      '<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" ' +
      'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';

    const center = id => ({
      cx: columns[id] * COL_W + PAD,
      cy: rows[id] * ROW_H + PAD + NODE_H / 2
    });

    subIds.forEach(id => {
      sub[id].childIds.forEach(cid => {
        const from = center(cid);
        const to = center(id);
        const x1 = from.cx + NODE_W, y1 = from.cy;
        const x2 = to.cx, y2 = to.cy;
        const dx = Math.max(40, (x2 - x1) / 2);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
        path.setAttribute("class", "edge");
        path.setAttribute("marker-end", "url(#arrowhead)");
        path.dataset.from = cid;
        path.dataset.to = id;
        svg.appendChild(path);

        // Two grab handles per edge, both reparenting this child (drag onto
        // another node to move it under that node). One sits at the parent end
        // (the arrowhead) and one at the child end (the start). A goal with many
        // children stacks every child's parent-end handle at the one parent, so
        // the child-end handle, which is unique per child, stays grabbable.
        [[x2 - 6, y2], [x1 + 6, y1]].forEach(([hx, hy]) => {
          const handle = document.createElementNS(SVG_NS, "circle");
          handle.setAttribute("cx", hx);
          handle.setAttribute("cy", hy);
          handle.setAttribute("r", 7);
          handle.setAttribute("class", "edge-handle");
          handle.addEventListener("pointerdown", e => startEdgeRetarget(e, cid, id, svg, handle, x1, y1));
          svg.appendChild(handle);
        });
      });
    });
    blockEl.appendChild(svg);

    subIds.forEach(id => {
      const node = nodes[id];
      const { cx, cy } = center(id);
      const el = renderGraphNode(node, progressMemo, statusMemo);
      el.style.left = cx + "px";
      el.style.top = (cy - NODE_H / 2) + "px";
      blockEl.appendChild(el);
    });

    container.appendChild(blockEl);
  }

  // Ungrouped goals keep the free-flowing, reorderable order at the start;
  // grouped goals render clustered into their tier's box, in group order.
  // (groupedIdSet was seeded above for visibility.)
  const ungroupedRoots = rootIds.filter(id => !groupedIdSet.has(id));
  ungroupedRoots.sort((a, b) => effectiveOrder(a, discoveryOrder) - effectiveOrder(b, discoveryOrder));
  lastRootOrder = ungroupedRoots;

  const flowEl = document.createElement("div");
  flowEl.className = "flow-area";
  // Root and child drags are both handled entirely by document-level
  // dragover/drop listeners that hit-test against geometry frozen at
  // dragstart (see resolveRootDrag and the child-reorder listeners). This
  // container deliberately has no drag handlers of its own: an earlier design
  // where it and the group boxes each ran their own handlers led to the two
  // fighting over the shared ghost and to a group box swallowing a child
  // drag's bubbling events.
  ungroupedRoots.forEach(rootId => renderRoot(rootId, flowEl));

  // A grouped goal keeps its group slot whenever it is visible and passes the
  // hide filter, even if it now also has a parent (so it renders here and under
  // that parent both).
  const groupMemberShown = id => !!nodes[id] && visibility[id] && passesHideFilter(id);
  const visibleGroupIds = state.groupsState.groupOrder.filter(gid =>
    (state.groupsState.groups[gid] || []).some(groupMemberShown));

  visibleGroupIds.forEach((gid, i) => {
    const visibleMembers = state.groupsState.groups[gid].filter(groupMemberShown);
    const groupEl = document.createElement("div");
    groupEl.className = "gear-group";
    groupEl.dataset.groupId = gid;
    // No drag handlers on the box itself: the document-level root listeners
    // own reorder-within / append / join, hit-testing the cursor against this
    // group's box (frozen at dragstart). The grip below is the one thing that
    // starts a whole-group reorder, so grabbing an icon vs the grip stays
    // unambiguous (native DnD uses the innermost draggable under the pointer).
    const grip = document.createElement("div");
    grip.className = "group-drag-handle";
    grip.textContent = "⣿"; // braille grip glyph
    grip.title = "Drag to reorder this group";
    grip.draggable = true;
    grip.addEventListener("dragstart", e => {
      e.stopPropagation();
      dragSourceGroupId = gid;
      dragSourceRootId = null;
      dragSourceChildId = null;
      e.dataTransfer.effectAllowed = "move";
      groupEl.classList.add("group-dragging");
      captureGroupRects();
    });
    grip.addEventListener("dragend", () => {
      groupEl.classList.remove("group-dragging");
      dragSourceGroupId = null;
      dragGroupRects = null;
      clearDragPreview();
    });
    groupEl.appendChild(grip);
    visibleMembers.forEach(id => renderRoot(id, groupEl));
    flowEl.appendChild(groupEl);

    if (i < visibleGroupIds.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "flow-arrow";
      arrow.textContent = "→";
      flowEl.appendChild(arrow);
    }
  });

  // Nothing on screen (e.g. a new profile from the Empty template): the
  // right-click "New goal" affordance needs chart space to target, so offer an
  // explicit centered button instead.
  if (!flowEl.children.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chart-empty-add";
    btn.textContent = "+ New goal";
    btn.addEventListener("click", () => openAddGoalModal(null));
    empty.appendChild(btn);
    flowEl.appendChild(empty);
  }

  chartEl.innerHTML = "";
  chartEl.appendChild(flowEl);
  lastColumns = mergedColumns;
  lastRows = mergedRows;
  lastNodeBlock = nodeBlock;

  applyFilter();
  updateOverallProgress(nodes);
}

function updateOverallProgress(nodes) {
  const leafIds = Object.keys(nodes).filter(id => nodes[id].childIds.length === 0);
  const total = leafIds.length;
  const completed = leafIds.filter(id => state.done[id]).length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  document.getElementById("overallFill").style.width = pct + "%";
  document.getElementById("overallLabel").textContent = `${completed} / ${total} (${pct}%)`;
}

// Expanding opens the whole subtree; collapsing only affects that one node.
function expandSubtree(id, nodes, seen) {
  seen = seen || new Set();
  if (seen.has(id)) return;
  seen.add(id);
  state.collapsed[id] = false;
  (nodes[id] && nodes[id].childIds || []).forEach(cid => expandSubtree(cid, nodes, seen));
}

function toggleCollapse(id) {
  if (isExpandedState(id)) {
    state.collapsed[id] = true;
  } else {
    expandSubtree(id, currentNodes);
  }
  saveState();
  render();
}

function markDone(id, value) {
  if (value) {
    state.done[id] = true;
  } else {
    delete state.done[id];
    cascadeUncheckAncestors(id, currentNodes);
  }
  saveState();
  render();
}

function renderGraphNode(node, progressMemo, statusMemo, opts) {
  const compact = !!(opts && opts.compact);
  const hasChildren = node.childIds.length > 0;
  const progress = progressOf(node.id, currentNodes, progressMemo);
  const status = computeStatus(node.id, currentNodes, statusMemo);
  const unlocked = isUnlocked(node.id, currentNodes, statusMemo);
  const canToggleDone = !hasChildren || unlocked;

  const div = document.createElement("div");
  div.className = "graph-node" + (node.type ? " type-" + node.type : "") + " status-" + status;
  div.dataset.id = node.id;
  div.dataset.title = node.title.toLowerCase();

  // Left click toggles collapse/expand for a goal with sub-goals; for a leaf it
  // toggles done/not-done directly. Interactive controls stopPropagation.
  div.addEventListener("click", () => {
    if (hasChildren) {
      toggleCollapse(node.id);
    } else if (canToggleDone && !isAutoTrackedSkill(node)) {
      markDone(node.id, status !== "done");
    }
  });
  div.addEventListener("contextmenu", e => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, node, { hasChildren, status, unlocked, canToggleDone });
  });
  div.addEventListener("mouseenter", () => setRelatedGlow(node.id, true));
  div.addEventListener("mouseleave", () => setRelatedGlow(node.id, false));

  if (node.parentIds.length === 0) {
    // Root goals: drag & drop forms/edits/reorders tier groups. Retargeting
    // is handled by one document-level dragover/drop listener (registered
    // below), the same pattern as child reordering: sibling geometry (every
    // compact icon on the page) is captured once at dragstart, and hit
    // testing happens against that frozen snapshot rather than this card's
    // own dragover/dragenter, or any live DOM query. That's what lets the
    // gap-opening preview nudge the other icons in a group without the shift
    // feeding back into what's considered "the target" (see
    // captureRootAllRects).
    div.draggable = true;
    div.addEventListener("dragstart", e => {
      dragSourceRootId = node.id;
      dragSourceChildId = null;
      dragSourceGroupId = null;
      e.dataTransfer.effectAllowed = "move";
      div.classList.add("dragging");
      captureRootAllRects();
    });
    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      dragSourceRootId = null;
      dragRootAllRects = null;
      dragRootGroupRects = null;
      clearDragPreview();
    });
  } else if (!compact) {
    // Child goals: drag & drop reorders among siblings in the same column.
    // Retargeting is handled by one document-level dragover/drop listener
    // (registered below) that hit-tests against sibling geometry captured
    // once at dragstart, not this card's own dragover/dragenter, and not
    // any live re-query of the DOM. That's what lets the gap-opening preview
    // physically nudge sibling cards without the shift feeding back into
    // what's considered "the target" (see captureChildSiblingRects).
    div.draggable = true;
    div.addEventListener("dragstart", e => {
      dragSourceChildId = node.id;
      dragSourceRootId = null;
      dragSourceGroupId = null;
      e.dataTransfer.effectAllowed = "move";
      div.classList.add("dragging");
      captureChildSiblingRects(node.id, div);
    });
    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      dragSourceChildId = null;
      dragChildSiblingRects = null;
      dragChildCanvas = null;
      pendingChildOrder = null;
      clearDragPreview();
    });
  }

  // Compact mode: icon only; every action moves to the right-click menu.
  if (compact) {
    div.classList.add("compact-node");
    div.title = node.title + (hasChildren ? ` (${progress.completed}/${progress.total})` : "");
    div.appendChild(renderIcon(node, "icon-slot-compact"));
    if (node.type === "skill") {
      const req = typeof parseSkillRequirement === "function" ? parseSkillRequirement(node.title) : null;
      if (req) {
        const levelBadge = document.createElement("span");
        levelBadge.className = "compact-level-badge";
        levelBadge.textContent = req.level;
        div.appendChild(levelBadge);
      }
    }
    if (status === "done") div.classList.add("compact-done");
    else if (!canToggleDone) div.classList.add("compact-locked");
    return div;
  }

  // A root inside a tier group has a fixed position there; reordering happens
  // by dragging instead of the up/down buttons.
  const isGroupedRoot = node.parentIds.length === 0 && getGroupOf(node.id) !== null;
  if (!isGroupedRoot) {
    const reorder = document.createElement("div");
    reorder.className = "reorder-controls";
    const upBtn = document.createElement("button");
    upBtn.className = "reorder-btn";
    upBtn.type = "button";
    upBtn.textContent = "▲";
    upBtn.title = "Move up";
    upBtn.addEventListener("click", e => { e.stopPropagation(); moveNode(node.id, -1); });
    const downBtn = document.createElement("button");
    downBtn.className = "reorder-btn";
    downBtn.type = "button";
    downBtn.textContent = "▼";
    downBtn.title = "Move down";
    downBtn.addEventListener("click", e => { e.stopPropagation(); moveNode(node.id, 1); });
    reorder.appendChild(upBtn);
    reorder.appendChild(downBtn);
    div.appendChild(reorder);
  }

  const body = document.createElement("div");
  body.className = "graph-node-body";
  div.appendChild(body);

  const top = document.createElement("div");
  top.className = "graph-node-top";

  if (hasChildren) {
    const toggle = document.createElement("span");
    toggle.className = "toggle";
    toggle.textContent = isExpandedState(node.id) ? "▾" : "▸";
    toggle.addEventListener("click", e => { e.stopPropagation(); toggleCollapse(node.id); });
    top.appendChild(toggle);
  }

  top.appendChild(renderIcon(node));

  const controls = document.createElement("div");
  controls.className = "status-controls";

  if (status === "done") {
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "action-btn done-btn";
    doneBtn.textContent = "✓";
    doneBtn.title = "Done — click to undo";
    doneBtn.addEventListener("click", e => { e.stopPropagation(); markDone(node.id, false); });
    controls.appendChild(doneBtn);
  } else if (isAutoTrackedSkill(node)) {
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "action-btn auto-btn";
    autoBtn.textContent = "📊";
    autoBtn.disabled = true;
    autoBtn.title = "Tracked automatically from your hiscores — sync your username in the toolbar";
    controls.appendChild(autoBtn);
  } else if (!canToggleDone) {
    const lockedBtn = document.createElement("button");
    lockedBtn.type = "button";
    lockedBtn.className = "action-btn locked-btn";
    lockedBtn.textContent = "🔒";
    lockedBtn.disabled = true;
    lockedBtn.title = "Locked until all sub-goals are done (" + progress.completed + "/" + progress.total + ")";
    controls.appendChild(lockedBtn);
  } else {
    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "action-btn check-btn";
    checkBtn.textContent = "✓";
    checkBtn.title = "Mark done";
    checkBtn.addEventListener("click", e => { e.stopPropagation(); markDone(node.id, true); });
    controls.appendChild(checkBtn);
  }
  top.appendChild(controls);

  body.appendChild(top);

  const titleEl = document.createElement("div");
  titleEl.className = "graph-node-title" + (status === "done" ? " done" : "");
  titleEl.textContent = node.title;
  titleEl.title = node.title;
  body.appendChild(titleEl);

  const footer = document.createElement("div");
  footer.className = "graph-node-footer";

  if (hasChildren) {
    const prog = document.createElement("span");
    prog.className = "graph-node-progress";
    prog.textContent = `${progress.completed}/${progress.total}`;
    footer.appendChild(prog);
  }

  if (node.parentIds.length > 1) {
    const badge = document.createElement("span");
    badge.className = "shared-badge";
    badge.textContent = `🔗×${node.parentIds.length}`;
    badge.title = "Unlocks " + node.parentIds.length + " goals";
    footer.appendChild(badge);
  }

  if (node.description) {
    const descBadge = document.createElement("span");
    descBadge.className = "desc-badge";
    descBadge.textContent = "📝";
    descBadge.title = node.description;
    footer.appendChild(descBadge);
  }

  if (node.link) {
    const a = document.createElement("a");
    a.className = "graph-node-link";
    a.href = node.link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = node.note || "wiki ↗";
    a.addEventListener("click", e => e.stopPropagation());
    footer.appendChild(a);
  }

  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn";
  editBtn.type = "button";
  editBtn.textContent = "✎";
  editBtn.title = "Edit goal";
  editBtn.addEventListener("click", e => { e.stopPropagation(); openEditGoalModal(node.id); });
  footer.appendChild(editBtn);

  const addLink = document.createElement("button");
  addLink.className = "add-link";
  addLink.type = "button";
  addLink.textContent = "+";
  addLink.title = "Add sub-goal";
  addLink.addEventListener("click", e => { e.stopPropagation(); openAddGoalModal(node.id); });
  footer.appendChild(addLink);

  body.appendChild(footer);

  return div;
}

// Highlights a node's direct parents/children (and the edges between them) while hovered.
function setRelatedGlow(id, on) {
  const node = currentNodes[id];
  if (!node) return;
  const relatedIds = new Set([...node.parentIds, ...node.childIds]);
  chartEl.querySelectorAll(".graph-node").forEach(el => {
    el.classList.toggle("related-glow", on && relatedIds.has(el.dataset.id));
  });
  chartEl.querySelectorAll(".edge").forEach(el => {
    const isRelated = (el.dataset.from === id || el.dataset.to === id);
    el.classList.toggle("edge-glow", on && isRelated);
  });
}

// Unchecking a node breaks the unlock condition above it, so any manually-done
// ancestor gets un-done too.
function cascadeUncheckAncestors(id, nodes, visited) {
  visited = visited || new Set();
  const n = nodes[id];
  if (!n) return;
  n.parentIds.forEach(pid => {
    if (visited.has(pid)) return;
    visited.add(pid);
    if (state.done[pid]) delete state.done[pid];
    cascadeUncheckAncestors(pid, nodes, visited);
  });
}
