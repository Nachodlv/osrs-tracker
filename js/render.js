
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
let costMemo = {};
// Per-block row tops and per-node heights from the last relayout pass; nodes
// with wrapped footers make their row taller, so rows are no longer on a fixed
// ROW_H pitch. Drag & drop reads these through rowTopIn().
let lastRowTops = {}, lastNodeHeights = {};
// Goals ticked while their block is open. A finished branch is dropped from its
// parent's block, so without this a goal would vanish the moment it was ticked
// and a misclick could not be undone. These stay put until the block is opened
// again (expandSubtree clears the set), which is when it is meant to shrink.
let justCompleted = new Set();

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
  beginIconPass();
  const { nodes, discoveryOrder } = getGraph();
  currentNodes = nodes;
  lastDiscoveryOrder = discoveryOrder;
  costMemo = {}; // subtree cost totals are only valid for this pass
  const blockLayouts = [];

  const rsnEl = document.getElementById("rsnInput");
  if (rsnEl && document.activeElement !== rsnEl) rsnEl.value = state.username || "";

  // Tier-group members render at top level (in their group box) even if they
  // have also been linked as a child of another goal, so seed them as root-like
  // before computing visibility.
  ensureGroupsState();
  const groupedIdSet = new Set();
  state.groupsState.groupOrder.forEach(gid =>
    (state.groupsState.groups[gid] || []).forEach(id => groupedIdSet.add(id)));

  const progressMemo = {};
  const statusMemo = {};
  const subtreeDoneMemo = {};
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
  // A goal is on the chart in its own right when nothing above it (top-level)
  // or when it holds a tier-group slot. Neither depends on what is expanded, so
  // this no longer needs a global visibility pass: whether a node renders as a
  // card is decided per block, by the walk in renderRoot.
  let rootIds = Object.keys(nodes).filter(id =>
    isChartRoot(id, nodes, groupedIdSet) && passesHideFilter(id));

  // Which sub-goals a block shows under `id`: the ones with work left, so a
  // finished branch drops out and a long chain shrinks as it gets completed.
  // A finished branch that is explicitly expanded stays put, which is what
  // makes a hidden one reachable again: the parent card carries a "✓N" chip
  // that expands them (revealDoneChildren), so ticking a goal by mistake is
  // never a dead end. When no sub-goal has work left the finished ones show
  // anyway, so clicking a goal open always reveals something. "Hide incomplete"
  // is the view where finished work is the point, so it keeps everything.
  const splitChildren = (blockRoot, id) => {
    const kids = nodes[id].childIds;
    if (hideIncomplete) return { shown: kids, doneKids: [], hiddenDone: [] };
    const done = new Set(kids.filter(cid => isSubtreeDone(cid, nodes, subtreeDoneMemo)));
    if (!done.size || done.size === kids.length) return { shown: kids, doneKids: [], hiddenDone: [] };
    const kept = cid => isExpandedIn(blockRoot, cid) || justCompleted.has(cid);
    return {
      shown: kids.filter(cid => !done.has(cid) || kept(cid)),
      doneKids: kids.filter(cid => done.has(cid)),
      hiddenDone: kids.filter(cid => done.has(cid) && !kept(cid)),
    };
  };
  const shownChildren = (blockRoot, id) => splitChildren(blockRoot, id).shown;

  function renderRoot(rootId, container) {
    const rootNode = nodes[rootId];
    const isExpanded = isExpandedState(rootId) && shownChildren(rootId, rootId).length > 0;

    if (!isExpanded) {
      const el = renderGraphNode(rootNode, progressMemo, statusMemo, { compact: true, blockRoot: rootId });
      el.classList.add("grid-mode");
      container.appendChild(el);
      return;
    }

    // This root's own local subtree. A node's sub-goals are only walked into
    // when that node is expanded IN THIS BLOCK, so the same goal can be open
    // here and shut in its own block (or under a different goal) at once.
    const sub = {};
    (function visit(id) {
      if (sub[id]) return;
      const kids = isExpandedIn(rootId, id) ? shownChildren(rootId, id) : [];
      sub[id] = Object.assign({}, nodes[id], { childIds: kids });
      kids.forEach(visit);
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

    drawBlockEdges(svg, sub, subIds, center);
    blockEl.appendChild(svg);

    const els = {};
    subIds.forEach(id => {
      const node = nodes[id];
      const { cx, cy } = center(id);
      // A finished-sub-goal chip only makes sense once this card is open, and
      // "open" is per block, so both the chip and the click handler carry the
      // block this card belongs to.
      const split = isExpandedIn(rootId, id)
        ? splitChildren(rootId, id)
        : { doneKids: [], hiddenDone: [] };
      const el = renderGraphNode(node, progressMemo, statusMemo,
        { doneKids: split.doneKids, hiddenDone: split.hiddenDone, blockRoot: rootId });
      el.style.left = cx + "px";
      el.style.top = (cy - NODE_H / 2) + "px";
      blockEl.appendChild(el);
      els[id] = el;
    });

    // Positions above assume every node is NODE_H tall. A node whose footer
    // wraps is taller, but heights are only measurable once this is in the
    // document, so record what relayoutBlocks needs for the second pass.
    blockLayouts.push({ rootId, sub, subIds, columns, rows, svg, blockEl, els });

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

  // A grouped goal keeps its group slot whenever it passes the hide filter,
  // even if it now also has a parent (so it renders here and under that parent
  // both) — the slot is what makes it a goal in its own right.
  const groupMemberShown = id => !!nodes[id] && passesHideFilter(id);
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
    // An empty profile is also the point where starting from a template makes
    // most sense, so surface the templates modal right next to it.
    const tplBtn = document.createElement("button");
    tplBtn.type = "button";
    tplBtn.className = "chart-empty-add";
    tplBtn.textContent = "+ Add template";
    tplBtn.addEventListener("click", () => openTemplatesModal());
    empty.appendChild(tplBtn);
    flowEl.appendChild(empty);
  }

  chartEl.innerHTML = "";
  chartEl.appendChild(flowEl);
  // Now in the document, so node heights can be measured and rows restacked.
  relayoutBlocks(blockLayouts);
  lastColumns = mergedColumns;
  lastRows = mergedRows;
  lastNodeBlock = nodeBlock;
  // Everything actually on the chart: block members plus the compact roots that
  // are not in one. Drag & drop reads this to find a node's column siblings.
  lastVisibleIds = [...new Set(Object.keys(nodeBlock).concat(rootIds))];

  applyFilter();
  updateOverallProgress(nodes);
  // Defined in currency-ui.js, which loads later; keeps an open ledger in step
  // with goals being ticked off behind it.
  if (typeof refreshCurrencyPanel === "function") refreshCurrencyPanel();
}

// Draws every edge in a block, plus the two drag handles per edge. Shared by
// the initial render and the post-measure relayout, which redraws with the real
// node heights.
function drawBlockEdges(svg, sub, subIds, center) {
  // Keep the <defs> (arrowhead marker), drop any previously drawn edges.
  [...svg.querySelectorAll("path.edge, circle.edge-handle")].forEach(el => el.remove());
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
}

// Second layout pass, run once the chart is in the document (the only point node
// heights can be measured). A node whose footer wrapped is taller than NODE_H,
// so give each row the height of its tallest node and restack the rows below,
// then redraw the edges against the new centers. Only the nodes that need the
// space grow; everything else keeps NODE_H.
function relayoutBlocks(layouts) {
  lastRowTops = {};
  lastNodeHeights = {};
  layouts.forEach(L => {
    const heights = {};
    let anyTaller = false;
    L.subIds.forEach(id => {
      const el = L.els[id];
      const h = el ? Math.round(el.getBoundingClientRect().height) : NODE_H;
      heights[id] = Math.max(NODE_H, h);
      if (heights[id] > NODE_H) anyTaller = true;
    });
    Object.assign(lastNodeHeights, heights);

    const maxRow = Math.max(0, ...L.subIds.map(id => L.rows[id]));
    const rowHeights = [];
    for (let r = 0; r <= maxRow; r++) rowHeights[r] = NODE_H;
    L.subIds.forEach(id => {
      const r = L.rows[id];
      if (heights[id] > rowHeights[r]) rowHeights[r] = heights[id];
    });

    const rowTops = [];
    let y = PAD;
    for (let r = 0; r <= maxRow; r++) {
      rowTops[r] = y;
      y += rowHeights[r] + GAP_Y;
    }
    lastRowTops[L.rootId] = rowTops;

    // Nothing wrapped, so the uniform first-pass positions are already correct.
    if (!anyTaller) return;

    L.subIds.forEach(id => {
      const el = L.els[id];
      if (el) el.style.top = rowTops[L.rows[id]] + "px";
    });

    const center = id => ({
      cx: L.columns[id] * COL_W + PAD,
      cy: rowTops[L.rows[id]] + heights[id] / 2
    });
    drawBlockEdges(L.svg, L.sub, L.subIds, center);

    const height = y - GAP_Y + PAD;
    L.blockEl.style.height = height + "px";
    L.svg.setAttribute("height", height);
  });
}

// Top of a row within a block, honouring any rows made taller by wrapped
// footers. Falls back to the uniform pitch before the first relayout.
function rowTopIn(blockRootId, rowIndex) {
  const tops = lastRowTops[blockRootId];
  if (tops && tops[rowIndex] != null) return tops[rowIndex];
  return rowIndex * ROW_H + PAD;
}

// A goal's costs for display: its own plus everything in its subtree, so a
// parent shows what finishing the whole branch costs. `rolledUp` marks a total
// that includes sub-goals, which the chip styles and explains differently.
// [{ name, amount, short, rolledUp }], empty when nothing in the branch costs.
function costPartsOf(id) {
  const totals = subtreeCosts(id, currentNodes, costMemo);
  // A done goal's own cost is already spent, so anything left is the sub-goals'.
  const own = (!state.done[id] && state.costs && state.costs[id]) || {};
  return Object.keys(totals).map(cid => {
    const amount = totals[cid];
    if (amount <= 0) return null;
    const name = (state.currencies[cid] && state.currencies[cid].name) || cid;
    return {
      name, amount, short: `${formatCurrencyAmount(amount)} ${name}`,
      rolledUp: (Number(own[cid]) || 0) !== amount
    };
  }).filter(Boolean).sort((a, b) => b.amount - a.amount);
}

function updateOverallProgress(nodes) {
  const leafIds = Object.keys(nodes).filter(id => nodes[id].childIds.length === 0);
  const total = leafIds.length;
  const completed = leafIds.filter(id => state.done[id]).length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  document.getElementById("overallFill").style.width = pct + "%";
  document.getElementById("overallLabel").textContent = `${completed} / ${total} (${pct}%)`;
}

// Expanding opens the subtree down to where the work still is: a sub-goal
// whose own sub-goals are all finished is collapsed instead, so big goals stay
// small as they get completed. The clicked goal always opens, so its finished
// sub-goals are one click away. Collapsing only affects that one node.
function expandSubtree(blockRoot, id, nodes, seen, doneMemo) {
  if (!seen) justCompleted.clear(); // opening the block is when it shrinks
  seen = seen || new Set();
  doneMemo = doneMemo || {};
  if (seen.has(id)) return;
  seen.add(id);
  setExpandedIn(blockRoot, id, true);
  (nodes[id] && nodes[id].childIds || []).forEach(cid => {
    if (seen.has(cid)) return;
    if (hasUnfinishedChild(cid, nodes, doneMemo)) {
      expandSubtree(blockRoot, cid, nodes, seen, doneMemo);
    } else {
      seen.add(cid);
      setExpandedIn(blockRoot, cid, false);
    }
  });
}

// A goal's dependency tree grows to the LEFT of it, so an expanded block can be
// several screens wide with the goal itself out past the right edge of the
// window (#chart scrolls horizontally). Nothing moves the viewport on its own,
// so opening a big goal used to look like the goal had disappeared. Bring it
// back into view: "nearest" scrolls the minimum, which leaves the goal at the
// edge with as much of its tree as fits alongside it.
function scrollGoalIntoView(id) {
  // Only quotes and backslashes need escaping inside a quoted attribute value;
  // goal ids are slugs, but custom titles have produced odd ones before.
  const el = chartEl.querySelector(`[data-id="${id.replace(/["\\]/g, "\\$&")}"]`);
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

// `blockRoot` is the block the clicked card belongs to; omitted (or equal to
// `id`) means the goal's own block. Toggling one card never moves the other.
function toggleCollapse(id, blockRoot) {
  const expanding = !isExpandedIn(blockRoot, id);
  if (expanding) {
    expandSubtree(blockRoot, id, currentNodes);
  } else {
    setExpandedIn(blockRoot, id, false);
  }
  saveState();
  render();
  if (expanding) scrollGoalIntoView(id);
}

function markDone(id, value) {
  if (value) {
    state.done[id] = true;
    justCompleted.add(id);
  } else {
    delete state.done[id];
    justCompleted.delete(id);
    cascadeUncheckAncestors(id, currentNodes);
  }
  saveState();
  render();
}

// Show (or re-hide) the finished sub-goals a goal's card is holding back in
// this block. Expanding them is what keeps them, see splitChildren.
function revealDoneChildren(blockRoot, id, reveal) {
  const doneMemo = {};
  ((currentNodes[id] || {}).childIds || []).forEach(cid => {
    if (isSubtreeDone(cid, currentNodes, doneMemo)) setExpandedIn(blockRoot, cid, reveal);
  });
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
  const blockRoot = opts && opts.blockRoot;
  div.addEventListener("click", () => {
    if (hasChildren) {
      toggleCollapse(node.id, blockRoot);
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
    // Icon-only, so costs join the tooltip rather than adding a chip.
    const costParts = costPartsOf(node.id);
    div.title = node.title + (hasChildren ? ` (${progress.completed}/${progress.total})` : "")
      + (costParts.length ? " — costs " + costParts.map(p => `${p.amount} ${p.name}`).join(", ")
          + (costParts.some(p => p.rolledUp) ? " (including sub-goals)" : "") : "");
    div.appendChild(renderIcon(node, "icon-slot-compact"));
    if (costParts.length) div.classList.add("has-cost");
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

  const body = document.createElement("div");
  body.className = "graph-node-body";
  div.appendChild(body);

  const top = document.createElement("div");
  top.className = "graph-node-top";

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

  // Finished sub-goals are dropped from this goal's block; this is the way back
  // to them (to untick one, or just to look).
  const doneKids = (opts && opts.doneKids) || [];
  const hiddenDone = (opts && opts.hiddenDone) || [];
  if (doneKids.length) {
    const showing = hiddenDone.length === 0;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "done-kids-badge" + (showing ? " showing" : "");
    chip.textContent = `✓${doneKids.length}`;
    chip.title = showing
      ? `Showing ${doneKids.length} finished sub-goal(s) — click to hide again`
      : `${hiddenDone.length} finished sub-goal(s) hidden — click to show`;
    chip.addEventListener("click", e => {
      e.stopPropagation();
      revealDoneChildren(blockRoot, node.id, !showing);
    });
    footer.appendChild(chip);
  }

  costPartsOf(node.id).forEach(part => {
    const chip = document.createElement("span");
    chip.className = "cost-badge" + (part.rolledUp ? " rolled-up" : "");
    chip.textContent = part.short;
    chip.title = part.rolledUp
      ? `${part.amount} ${part.name} for this goal and its sub-goals`
      : `Costs ${part.amount} ${part.name}`;
    footer.appendChild(chip);
  });

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
