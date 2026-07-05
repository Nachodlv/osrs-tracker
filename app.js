const STORAGE_KEY = "iron-tracker:v1";
const PROFILES_KEY = "iron-tracker:profiles";
const DEFAULT_PROFILE_ID = "default";

// --- Profiles -----------------------------------------------------------------
// Each profile is its own localStorage key holding the same shape of state. A
// meta record (PROFILES_KEY) tracks which profiles exist and which is active.
// The "default" profile reuses the original STORAGE_KEY for backwards compat.

function loadProfilesMeta() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.profiles && parsed.profiles[DEFAULT_PROFILE_ID]) return parsed;
    }
  } catch (e) {
    console.error("Failed to load profiles", e);
  }
  return { activeId: DEFAULT_PROFILE_ID, profiles: { [DEFAULT_PROFILE_ID]: { name: "Default" } } };
}

function saveProfilesMeta() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesMeta));
}

function storageKeyFor(profileId) {
  return profileId === DEFAULT_PROFILE_ID ? STORAGE_KEY : STORAGE_KEY + ":" + profileId;
}

let profilesMeta = loadProfilesMeta();

// Eagerly migrate every profile's saved data (not just the active one) so no
// profile's progress goes stale after an id rename — see migration.js.
(function migrateAllProfilesEagerly() {
  Object.keys(profilesMeta.profiles).forEach(id => {
    const key = storageKeyFor(id);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const migrated = migrateStateData(JSON.parse(raw));
      const after = JSON.stringify(migrated);
      if (after !== raw) localStorage.setItem(key, after);
    } catch (e) {
      console.error("Failed to migrate profile", id, e);
    }
  });
})();

function defaultState() {
  return {
    done: {}, order: {}, customNodes: {}, linkedEdges: {}, removedEdges: {},
    collapsed: {}, overrides: {}, removed: {}, username: "",
    // Built-in goals detached from every parent, promoted to standalone
    // top-level goals (kept alive past pruneRemoved). Keyed by node id.
    rootGoals: {},
    // Lazily seeded from GEAR_GROUPS on first render; from then on it's the
    // user-editable source of truth for tier groupings.
    groupsState: null
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKeyFor(profilesMeta.activeId));
    if (!raw) return defaultState();
    const parsed = migrateStateData(JSON.parse(raw));
    return Object.assign(defaultState(), {
      done: parsed.done || {},
      order: parsed.order || {},
      customNodes: parsed.customNodes || {},
      linkedEdges: parsed.linkedEdges || {},
      removedEdges: parsed.removedEdges || {},
      collapsed: parsed.collapsed || {},
      overrides: parsed.overrides || {},
      removed: parsed.removed || {},
      username: parsed.username || "",
      rootGoals: parsed.rootGoals || {},
      groupsState: parsed.groupsState || null
    });
  } catch (e) {
    console.error("Failed to load tracker state", e);
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(storageKeyFor(profilesMeta.activeId), JSON.stringify(state));
}

function switchProfile(id) {
  if (!profilesMeta.profiles[id] || id === profilesMeta.activeId) return;
  profilesMeta.activeId = id;
  saveProfilesMeta();
  state = loadState();
  clearUndo();
  refreshProfileSelect();
  render();
}

function createProfile(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  const id = "p" + Date.now();
  profilesMeta.profiles[id] = { name: trimmed };
  profilesMeta.activeId = id;
  saveProfilesMeta();
  state = loadState();
  clearUndo();
  refreshProfileSelect();
  render();
}

function renameProfile(id, name) {
  const trimmed = (name || "").trim();
  if (!trimmed || !profilesMeta.profiles[id]) return;
  profilesMeta.profiles[id].name = trimmed;
  saveProfilesMeta();
  refreshProfileSelect();
}

function deleteProfile(id) {
  if (Object.keys(profilesMeta.profiles).length <= 1) return;
  localStorage.removeItem(storageKeyFor(id));
  delete profilesMeta.profiles[id];
  if (profilesMeta.activeId === id) {
    profilesMeta.activeId = Object.keys(profilesMeta.profiles)[0];
    state = loadState();
  }
  clearUndo();
  saveProfilesMeta();
  refreshProfileSelect();
  render();
}

function refreshProfileSelect() {
  if (!profileSelectEl) return;
  profileSelectEl.innerHTML = "";
  Object.keys(profilesMeta.profiles).forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = profilesMeta.profiles[id].name;
    if (id === profilesMeta.activeId) opt.selected = true;
    profileSelectEl.appendChild(opt);
  });
  if (profileDeleteBtnEl) profileDeleteBtnEl.disabled = Object.keys(profilesMeta.profiles).length <= 1;
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// --- Undo --------------------------------------------------------------------
// Each undoable user action runs inside withUndo(): it snapshots the serialized
// state before the action and, if the action changed anything, shows a toast
// offering to restore that snapshot. Nested withUndo calls (an action that
// delegates to another) collapse into the outermost, so one action = one undo.
// Only the single most recent action is undoable.
let undoActive = false;
let undoData = null; // { before, label }
let undoToastEl = null;
let undoToastTimer = null;

function withUndo(label, fn) {
  if (undoActive) return fn(); // nested; the outermost action owns the undo
  undoActive = true;
  const before = JSON.stringify(state);
  let result;
  try { result = fn(); } finally { undoActive = false; }
  if (JSON.stringify(state) !== before) {
    undoData = { before, label };
    showUndoToast(label);
  }
  return result;
}

function dismissUndoToast() {
  if (undoToastEl) { undoToastEl.remove(); undoToastEl = null; }
  if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
}

// Called on profile switch/import: the snapshot belongs to a different profile.
function clearUndo() {
  undoData = null;
  dismissUndoToast();
}

function performUndo() {
  if (!undoData) return;
  state = JSON.parse(undoData.before);
  undoData = null;
  dismissUndoToast();
  saveState();
  render();
  showToast("Undone");
}

function showUndoToast(label) {
  dismissUndoToast();
  const t = document.createElement("div");
  t.className = "toast undo-toast";
  const msg = document.createElement("span");
  msg.className = "undo-toast-label";
  msg.textContent = label;
  t.appendChild(msg);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "undo-toast-btn";
  btn.textContent = "Undo";
  btn.addEventListener("click", performUndo);
  t.appendChild(btn);
  document.body.appendChild(t);
  undoToastEl = t;
  undoToastTimer = setTimeout(dismissUndoToast, 7000);
}

// Nodes sharing a `shared` key store their completion under that one key, so
// checking it anywhere checks it everywhere.
function effectiveId(node) {
  return node.shared || node.id;
}

function uid() {
  return "custom-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

// Merge user-added custom nodes into the static data tree (by parent id, which
// may be a raw node id or a `shared` key).
function getEffectiveTree() {
  const clone = JSON.parse(JSON.stringify(GOAL_DATA));
  const byId = {};
  const byShared = {};
  function index(nodes) {
    nodes.forEach(n => {
      byId[n.id] = n;
      if (n.shared) {
        if (!byShared[n.shared]) byShared[n.shared] = [];
        byShared[n.shared].push(n);
      }
      if (!n.children) n.children = [];
      index(n.children);
    });
  }
  index(clone);

  // Materialize every custom node and register it up front, so a custom node
  // parented by another custom node resolves regardless of iteration order (a
  // single pass would drop a child whose custom parent comes later).
  const customObjs = {};
  Object.values(state.customNodes).forEach(custom => {
    const node = {
      id: custom.id, title: custom.title, type: custom.type || "other", children: [], custom: true,
      iconUrl: custom.iconUrl, description: custom.description,
      link: custom.linkDisabled ? null : (custom.link || null),
      note: custom.linkDisabled ? null : (custom.note || null)
    };
    customObjs[custom.id] = node;
    byId[custom.id] = node;
  });

  // Attach each custom node to its parent (a static node, a `shared` key, or
  // another custom node), or make it a top-level goal if it has no parent. A
  // node whose named parent no longer exists is dropped.
  Object.values(state.customNodes).forEach(custom => {
    const node = customObjs[custom.id];
    let parent = byId[custom.parentId];
    if (!parent && byShared[custom.parentId] && byShared[custom.parentId].length) {
      parent = byShared[custom.parentId][0];
    }
    if (!parent && custom.parentId) return;
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      clone.push(node);
    }
  });

  return { tree: clone, byId };
}

// --- Graph construction -----------------------------------------------------
// Collapses the tree into a DAG keyed by effectiveId, so a shared requirement
// becomes a single node with multiple parents. User-drawn link edges
// (state.linkedEdges) are folded in; user-detached edges (state.removedEdges)
// are stripped. Built-in goals can be renamed via state.overrides or hidden via
// state.removed.

function buildGraph(tree) {
  const nodes = {};
  const discoveryOrder = {};
  let counter = 0;
  const originalRootIds = new Set(tree.map(effectiveId));

  function ensure(raw) {
    const id = effectiveId(raw);
    if (!nodes[id]) {
      const ov = state.overrides[id];
      const effectiveType = (ov && ov.type) || raw.type;
      nodes[id] = {
        id, title: raw.title, type: effectiveType, link: raw.link, note: raw.note,
        shared: raw.shared, custom: raw.custom, icon: raw.icon, iconUrl: raw.iconUrl,
        description: raw.description, childIds: [], parentIds: []
      };
      const defaultLink = typeof resolveDefaultLink === "function"
        ? resolveDefaultLink({ type: effectiveType, title: (ov && ov.title) || raw.title, link: raw.link })
        : null;
      if (defaultLink) {
        nodes[id].link = defaultLink.link;
        nodes[id].note = defaultLink.note;
      }
      if (ov) {
        if (ov.title) nodes[id].title = ov.title;
        if (ov.iconUrl) nodes[id].iconUrl = ov.iconUrl;
        if (ov.description !== undefined) nodes[id].description = ov.description;
        if (ov.linkDisabled) { nodes[id].link = null; nodes[id].note = null; }
        else if (ov.link) { nodes[id].link = ov.link; nodes[id].note = null; }
      }
    }
    if (discoveryOrder[id] == null) discoveryOrder[id] = counter++;
    return nodes[id];
  }

  function addEdge(parentRecord, childId) {
    if (!parentRecord.childIds.includes(childId)) parentRecord.childIds.push(childId);
    const child = nodes[childId];
    if (child && !child.parentIds.includes(parentRecord.id)) child.parentIds.push(parentRecord.id);
  }

  function walk(raw, parentId) {
    const n = ensure(raw);
    if (parentId && !n.parentIds.includes(parentId)) n.parentIds.push(parentId);
    (raw.children || []).forEach(child => {
      const cid = effectiveId(child);
      if (!n.childIds.includes(cid)) n.childIds.push(cid);
      walk(child, n.id);
    });
  }

  tree.forEach(root => walk(root, null));

  // Strip user-detached edges (edge retargeting) before folding link edges, so
  // re-linking the same pair later still works.
  Object.keys(state.removedEdges || {}).forEach(parentId => {
    const parent = nodes[parentId];
    if (!parent) return;
    (state.removedEdges[parentId] || []).forEach(childId => {
      parent.childIds = parent.childIds.filter(x => x !== childId);
      if (nodes[childId]) {
        nodes[childId].parentIds = nodes[childId].parentIds.filter(x => x !== parentId);
      }
    });
  });

  // Fold in manually linked edges, guarding against cycles.
  Object.keys(state.linkedEdges).forEach(parentId => {
    const parent = nodes[parentId];
    if (!parent) return;
    (state.linkedEdges[parentId] || []).forEach(childId => {
      if (!nodes[childId]) return;
      if (childId === parentId) return;
      if (isAncestor(childId, parentId, nodes)) return;
      addEdge(parent, childId);
    });
  });

  pruneRemoved(nodes, originalRootIds);

  return { nodes, discoveryOrder };
}

// Deletes user-removed nodes, strips dangling edges, then repeatedly drops nodes
// left with zero parents (that weren't original top-level goals) — removing a
// goal also removes sub-goals that only existed to feed it, while a shared
// requirement used elsewhere survives.
function pruneRemoved(nodes, originalRootIds) {
  Object.keys(state.removed).forEach(id => {
    if (state.removed[id]) delete nodes[id];
  });

  function stripDangling() {
    Object.values(nodes).forEach(n => {
      n.childIds = n.childIds.filter(cid => nodes[cid]);
      n.parentIds = n.parentIds.filter(pid => nodes[pid]);
    });
  }
  stripDangling();

  let changed = true;
  while (changed) {
    changed = false;
    Object.keys(nodes).forEach(id => {
      if (originalRootIds.has(id)) return;
      // A goal the user detached from all parents survives as a standalone
      // top-level goal instead of being cascade-pruned.
      if (state.rootGoals && state.rootGoals[id]) return;
      const n = nodes[id];
      if (n && n.parentIds.length === 0) {
        delete nodes[id];
        changed = true;
      }
    });
    if (changed) stripDangling();
  }
}

// Is `candidateId` an ancestor of `id`? Used to reject edges that would create a cycle.
function isAncestor(candidateId, id, nodes, seen) {
  seen = seen || new Set();
  if (seen.has(id)) return false;
  seen.add(id);
  const n = nodes[id];
  if (!n) return false;
  if (n.parentIds.includes(candidateId)) return true;
  return n.parentIds.some(pid => isAncestor(candidateId, pid, nodes, seen));
}

// column(node) = 0 for leaves, else 1 + max(column of children).
function computeColumns(nodes) {
  const memo = {};
  function col(id) {
    if (memo[id] != null) return memo[id];
    memo[id] = 0; // cycle guard
    const n = nodes[id];
    if (!n.childIds.length) { memo[id] = 0; return 0; }
    const c = 1 + Math.max(...n.childIds.map(col));
    memo[id] = c;
    return c;
  }
  Object.keys(nodes).forEach(col);
  return memo;
}

function effectiveOrder(id, discoveryOrder) {
  return state.order[id] != null ? state.order[id] : discoveryOrder[id];
}

// Layered (Sugiyama-style) row assignment. Leaves are ordered by the user's
// manual order (falling back to discovery order). Later columns place nodes
// near the average row of their children — unless the user has manually
// reordered that column, in which case manual order wins (this is what makes
// reordering non-leaf goals like quests-with-prerequisites actually work).
function computeRows(nodes, columns, discoveryOrder) {
  const rows = {};
  const columnOrder = {};
  const maxCol = Math.max(0, ...Object.values(columns));
  for (let c = 0; c <= maxCol; c++) {
    const ids = Object.keys(nodes).filter(id => columns[id] === c);
    if (c === 0) {
      ids.sort((a, b) => effectiveOrder(a, discoveryOrder) - effectiveOrder(b, discoveryOrder));
      ids.forEach((id, i) => { rows[id] = i; });
      columnOrder[c] = ids;
      continue;
    }
    const desired = {};
    ids.forEach(id => {
      const childRows = nodes[id].childIds.map(cid => rows[cid]).filter(r => r != null);
      desired[id] = childRows.length
        ? childRows.reduce((a, b) => a + b, 0) / childRows.length
        : effectiveOrder(id, discoveryOrder);
    });
    ids.sort((a, b) => {
      const ma = state.order[a], mb = state.order[b];
      if (ma != null && mb != null) return ma - mb || desired[a] - desired[b];
      return desired[a] - desired[b] || effectiveOrder(a, discoveryOrder) - effectiveOrder(b, discoveryOrder);
    });
    // state.order only decides the sequence (via the sort above); the row
    // number itself still snaps toward the child average so parents stay
    // level with their children instead of packing into bare consecutive rows.
    let nextRow = 0;
    ids.forEach(id => {
      const r = Math.max(nextRow, Math.round(desired[id]));
      rows[id] = r;
      nextRow = r + 1;
    });
    columnOrder[c] = ids;
  }
  return { rows, columnOrder };
}

// A node's subtree defaults to collapsed/compact until explicitly expanded —
// state.collapsed[id] === false means "explicitly expanded".
function isExpandedState(id) {
  return state.collapsed[id] === false;
}

// A node is visible if it's a root or has at least one visible, expanded parent.
// `rootLike` ids are shown at top level regardless of parents (tier-group
// members keep their group slot even after being linked as a child elsewhere,
// so they render in both places).
function computeVisibility(nodes, rootLike) {
  const vis = {};
  function isVis(id) {
    if (vis[id] != null) return vis[id];
    vis[id] = true; // cycle guard
    const n = nodes[id];
    if (!n.parentIds.length || (rootLike && rootLike.has(id))) { vis[id] = true; return true; }
    const v = n.parentIds.some(pid => isVis(pid) && isExpandedState(pid));
    vis[id] = v;
    return v;
  }
  Object.keys(nodes).forEach(isVis);
  return vis;
}

// --- Status model ------------------------------------------------------------
// Two states: todo or done (state.done). A parent only reaches "done" once
// manually ticked, gated by isUnlocked.

// A skill goal with a parseable "<level> <Skill>" requirement is tracked
// automatically from hiscores; compound requirements stay manual.
function isAutoTrackedSkill(node) {
  return node.type === "skill" && !!(typeof parseSkillRequirement === "function" && parseSkillRequirement(node.title));
}

function computeStatus(id, nodes, memo) {
  if (memo[id]) return memo[id];
  const s = state.done[id] ? "done" : "todo";
  memo[id] = s;
  return s;
}

// A parent's "done" checkbox only unlocks once every child is done.
function isUnlocked(id, nodes, statusMemo) {
  const n = nodes[id];
  if (!n.childIds.length) return true;
  return n.childIds.every(cid => computeStatus(cid, nodes, statusMemo) === "done");
}

function progressOf(id, nodes, memo) {
  if (memo[id]) return memo[id];
  const n = nodes[id];
  if (!n.childIds.length) {
    const r = { total: 1, completed: state.done[id] ? 1 : 0 };
    memo[id] = r;
    return r;
  }
  let total = 0, completed = 0;
  n.childIds.forEach(cid => {
    const p = progressOf(cid, nodes, memo);
    total += p.total;
    completed += p.completed;
  });
  const r = { total, completed };
  memo[id] = r;
  return r;
}

// --- Icon rendering ----------------------------------------------------------

// Icon slot for a node: real wiki icon when resolvable, else the type's emoji.
function renderIcon(node, sizeClass) {
  const slot = document.createElement("span");
  slot.className = "icon-slot" + (node.type ? " type-" + node.type : "") + (sizeClass ? " " + sizeClass : "");

  const fallbackEmoji = node.type && TYPE_META[node.type] ? TYPE_META[node.type].icon : "";
  const fallbackLabel = node.type && TYPE_META[node.type] ? TYPE_META[node.type].label : "";
  const src = node.iconUrl || (typeof resolveIconFile === "function" && resolveIconFile(node)
    ? WIKI_ICON_BASE + encodeURIComponent(resolveIconFile(node))
    : null);

  if (!src) {
    if (fallbackEmoji) {
      slot.textContent = fallbackEmoji;
      slot.title = fallbackLabel;
    } else {
      slot.classList.add("icon-slot-empty");
    }
    return slot;
  }

  const img = document.createElement("img");
  img.src = src;
  img.alt = fallbackLabel || node.title;
  img.title = node.title;
  img.loading = "lazy";
  img.addEventListener("error", () => {
    if (fallbackEmoji) {
      slot.textContent = fallbackEmoji;
      slot.title = fallbackLabel;
    } else {
      slot.classList.add("icon-slot-empty");
    }
  }, { once: true });
  slot.appendChild(img);
  return slot;
}

// Wiki icon + page link lookup via the MediaWiki search API. Best-effort —
// returns nulls on any failure.
async function fetchWikiInfo(query) {
  const base = "https://oldschool.runescape.wiki/api.php";
  const empty = { iconUrl: null, link: null, pageTitle: null };
  if (!query || !query.trim()) return empty;
  try {
    const searchUrl = `${base}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;
    const searchJson = await fetch(searchUrl).then(r => r.json());
    const hit = searchJson && searchJson.query && searchJson.query.search && searchJson.query.search[0];
    if (!hit) return empty;
    const link = `https://oldschool.runescape.wiki/w/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
    const imgUrl = `${base}?action=query&titles=${encodeURIComponent(hit.title)}&prop=pageimages&pithumbsize=64&format=json&origin=*`;
    const imgJson = await fetch(imgUrl).then(r => r.json());
    const pages = imgJson && imgJson.query && imgJson.query.pages;
    const page = pages && Object.values(pages)[0];
    const iconUrl = (page && page.thumbnail && page.thumbnail.source) || null;
    return { iconUrl, link, pageTitle: hit.title };
  } catch (e) {
    console.warn("Wiki lookup failed for", query, e);
    return empty;
  }
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

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
  ghost.style.top = (canvasRect.top + rows[dragSourceChildId] * ROW_H + PAD) + "px";

  Object.keys(rows).forEach(id => {
    if (id === dragSourceChildId) return;
    const delta = rows[id] - lastRows[id];
    if (!delta) return;
    const el = findGraphNodeEl(canvas, id);
    if (el) {
      el.style.transform = `translateY(${delta * ROW_H}px)`;
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

// --- Add / Edit goal modal ----------------------------------------------------
// One modal handles both flows:
//  - Add: create a new sub-goal under `goalParentId`, or (if a suggestion is
//    picked) link an existing goal in as a shared prerequisite — the form is
//    prefilled from that goal, and changing any field edits it on submit.
//  - Edit: rename/re-icon/re-link/delete `goalEditId` (built-in goals store an
//    override patch; custom ones are edited directly).

const modalEl = document.getElementById("goalModal");
const modalForm = document.getElementById("goalForm");
const modalTitleEl = document.getElementById("goalModalTitle");
const nameInput = document.getElementById("goalName");
const typeSelect = document.getElementById("goalTypeSelect");
const iconQueryInput = document.getElementById("goalIconQuery");
const iconQueryLabel = document.getElementById("goalIconQueryLabel");
const iconQueryHint = document.getElementById("goalIconQueryHint");
const iconPreviewSlot = document.getElementById("goalIconPreview");
const linkQueryInput = document.getElementById("goalLinkQuery");
const linkQueryHint = document.getElementById("goalLinkQueryHint");
const linkDisabledCheckbox = document.getElementById("goalLinkDisabled");
const linkPreviewEl = document.getElementById("goalLinkPreview");
const descriptionInput = document.getElementById("goalDescription");
const suggestionsEl = document.getElementById("goalSuggestions");
const linkNoticeEl = document.getElementById("goalLinkNotice");
const linksSectionEl = document.getElementById("goalLinksSection");
const childLinksEl = document.getElementById("goalChildLinks");
const childAddInput = document.getElementById("goalChildAddInput");
const childAddSuggestionsEl = document.getElementById("goalChildAddSuggestions");
const parentLinksEl = document.getElementById("goalParentLinks");
const parentAddInput = document.getElementById("goalParentAddInput");
const parentAddSuggestionsEl = document.getElementById("goalParentAddSuggestions");
const errorEl = document.getElementById("goalError");
const cancelBtn = document.getElementById("goalCancel");
const deleteBtn = document.getElementById("goalDelete");
const submitBtn = document.getElementById("goalSubmit");

let goalMode = "add"; // "add" | "edit"
let goalParentId = null;
let goalEditId = null;
let goalLinkedExistingId = null;
let goalLinkedSnapshot = null; // fields at link time, to detect user edits

function setIconPreview(url, fallbackText) {
  iconPreviewSlot.innerHTML = "";
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "icon preview";
    img.addEventListener("error", () => { iconPreviewSlot.textContent = "?"; }, { once: true });
    iconPreviewSlot.appendChild(img);
  } else {
    iconPreviewSlot.textContent = fallbackText || "—";
  }
}

// Skill/quest icons+links are deterministic, so their previews never need a
// network round trip. Only "other" goes through a fuzzy wiki search.
function updateFieldHints() {
  const type = typeSelect.value;
  if (type === "skill") {
    iconQueryLabel.textContent = "Skill override";
    iconQueryHint.textContent = "(optional — leave blank to detect the skill from the name)";
    iconQueryInput.placeholder = "e.g. Agility";
    iconQueryInput.disabled = false;
    linkQueryHint.textContent = "(optional — leave blank to detect the skill from the name)";
    linkQueryInput.placeholder = "e.g. Agility";
  } else if (type === "quest") {
    iconQueryLabel.textContent = "Icon override";
    iconQueryHint.textContent = "(quests always use the quest icon)";
    iconQueryInput.placeholder = "";
    iconQueryInput.disabled = true;
    linkQueryHint.textContent = "(optional — leave blank to use the exact quest name)";
    linkQueryInput.placeholder = "e.g. Cabin Fever";
  } else {
    iconQueryLabel.textContent = "Icon override";
    iconQueryHint.textContent = "(optional — leave blank to auto-search using the name)";
    iconQueryInput.placeholder = "e.g. Dragon scimitar";
    iconQueryInput.disabled = false;
    linkQueryHint.textContent = "(optional — leave blank to auto-search using the name)";
    linkQueryInput.placeholder = "e.g. Eagles' Peak";
  }
}

let previewGeneration = 0;

const updateLivePreview = debounce(async () => {
  const myGeneration = ++previewGeneration;
  const isStale = () => myGeneration !== previewGeneration;

  const type = typeSelect.value;
  const name = nameInput.value.trim();
  const iconQuery = iconQueryInput.value.trim() || name;
  const linkQuery = linkQueryInput.value.trim() || name;

  if (type === "skill") {
    const skill = typeof detectSkillName === "function" ? detectSkillName(iconQuery) : null;
    setIconPreview(skill ? WIKI_ICON_BASE + skill + "_icon.png" : null, skill ? null : "?");
  } else if (type === "quest") {
    setIconPreview(WIKI_ICON_BASE + "Quest_point_icon.png", null);
  } else if (!iconQuery) {
    setIconPreview(null, "—");
  } else {
    const info = await fetchWikiInfo(iconQuery);
    if (isStale()) return;
    setIconPreview(info.iconUrl, info.iconUrl ? null : "?");
  }

  if (linkDisabledCheckbox.checked) {
    linkPreviewEl.textContent = "No wiki link";
  } else if (type === "skill") {
    const skill = typeof detectSkillName === "function" ? detectSkillName(linkQuery) : null;
    linkPreviewEl.textContent = skill ? "→ Ironman Guide: " + skill : "No skill detected in that text";
  } else if (type === "quest") {
    linkPreviewEl.textContent = linkQuery ? "→ " + linkQuery : "—";
  } else if (!linkQuery) {
    linkPreviewEl.textContent = "—";
  } else {
    const info = await fetchWikiInfo(linkQuery);
    if (isStale()) return;
    linkPreviewEl.textContent = info.pageTitle ? ("→ " + info.pageTitle) : "No match found";
  }
}, 400);

[nameInput, iconQueryInput, linkQueryInput].forEach(el => {
  el.addEventListener("input", updateLivePreview);
});
linkDisabledCheckbox.addEventListener("change", updateLivePreview);
typeSelect.addEventListener("change", () => { updateFieldHints(); updateLivePreview(); });

function currentGoalFields() {
  return {
    title: nameInput.value.trim(),
    type: typeSelect.value,
    iconQuery: iconQueryInput.value.trim(),
    linkQuery: linkQueryInput.value.trim(),
    linkDisabled: linkDisabledCheckbox.checked,
    description: descriptionInput.value.trim()
  };
}

function resetGoalModalFields() {
  nameInput.value = "";
  typeSelect.value = "other";
  iconQueryInput.value = "";
  linkQueryInput.value = "";
  linkDisabledCheckbox.checked = false;
  descriptionInput.value = "";
  updateFieldHints();
  setIconPreview(null, "—");
  linkPreviewEl.textContent = "—";
  suggestionsEl.innerHTML = "";
  linkNoticeEl.hidden = true;
  errorEl.hidden = true;
  goalLinkedExistingId = null;
  goalLinkedSnapshot = null;
  // Clear any leftover links from a previously edited goal so add mode never
  // shows stale parent/child rows.
  childLinksEl.innerHTML = "";
  parentLinksEl.innerHTML = "";
  childAddInput.value = ""; childAddSuggestionsEl.innerHTML = "";
  parentAddInput.value = ""; parentAddSuggestionsEl.innerHTML = "";
}

// Fills the form from an existing node (used by add-mode autocomplete and edit mode).
function fillGoalFieldsFromNode(node) {
  const source = node.custom ? (state.customNodes[node.id] || {}) : (state.overrides[node.id] || {});
  nameInput.value = node.title;
  typeSelect.value = node.type || "other";
  updateFieldHints();
  iconQueryInput.value = source.iconQuery || "";
  linkQueryInput.value = source.linkQuery || "";
  linkDisabledCheckbox.checked = !!source.linkDisabled;
  descriptionInput.value = node.description || "";
  setIconPreview(node.iconUrl || (typeof resolveIconFile === "function" && resolveIconFile(node) ? WIKI_ICON_BASE + encodeURIComponent(resolveIconFile(node)) : null), "—");
  linkPreviewEl.textContent = source.linkDisabled ? "No wiki link" : (node.link ? "→ " + (node.note || node.title) : "—");
}

// A "goal · ×" row for the edit-mode links lists.
function makeLinkRow(title, onRemove) {
  const row = document.createElement("div");
  row.className = "goal-link-row";
  const label = document.createElement("span");
  label.className = "goal-link-title";
  label.textContent = title;
  row.appendChild(label);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "goal-link-remove";
  btn.textContent = "×";
  btn.title = "Remove link";
  btn.addEventListener("click", () => { onRemove(); refreshGoalLinksOrClose(); });
  row.appendChild(btn);
  return row;
}

function emptyLinkHint(text) {
  const p = document.createElement("div");
  p.className = "goal-link-empty";
  p.textContent = text;
  return p;
}

// Populates the sub-goal (child) and unlocks (parent) lists for the goal being
// edited, with a remove button per link.
function renderGoalLinks(id) {
  const node = currentNodes[id];
  if (!node) { linksSectionEl.hidden = true; return; }
  linksSectionEl.hidden = false;

  childLinksEl.innerHTML = "";
  node.childIds.forEach(cid => {
    const c = currentNodes[cid];
    childLinksEl.appendChild(makeLinkRow(c ? c.title : cid, () => detachEdge(id, cid)));
  });
  if (!node.childIds.length) childLinksEl.appendChild(emptyLinkHint("No sub-goals yet."));

  parentLinksEl.innerHTML = "";
  node.parentIds.forEach(pid => {
    const p = currentNodes[pid];
    parentLinksEl.appendChild(makeLinkRow(p ? p.title : pid, () => detachEdge(pid, id)));
  });
  if (!node.parentIds.length) parentLinksEl.appendChild(emptyLinkHint("Not a prerequisite of anything yet."));

  childAddInput.value = ""; childAddSuggestionsEl.innerHTML = "";
  parentAddInput.value = ""; parentAddSuggestionsEl.innerHTML = "";
}

// After a link edit, the edited node may have been pruned (a built-in goal that
// lost its only parent); if so, close the modal, otherwise refresh the lists.
function refreshGoalLinksOrClose() {
  if (goalMode !== "edit" || !goalEditId) return;
  if (!currentNodes[goalEditId]) { closeGoalModal(); showToast("Goal removed (it had no remaining links)."); return; }
  renderGoalLinks(goalEditId);
}

// Wires an add-link input: typing filters existing goals (excluding self,
// already-linked, and any that would create a cycle); picking one links it.
// direction "child": edited goal -> picked (picked becomes a sub-goal).
// direction "parent": picked -> edited goal (edited becomes a sub-goal).
function wireLinkAdder(input, suggestionsBox, direction) {
  input.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    suggestionsBox.innerHTML = "";
    const node = goalEditId && currentNodes[goalEditId];
    if (!node || q.length < 2) return;
    const linkedSet = new Set(direction === "child" ? node.childIds : node.parentIds);
    const matches = Object.values(currentNodes).filter(n => {
      if (n.id === goalEditId || linkedSet.has(n.id)) return false;
      if (!n.title.toLowerCase().includes(q)) return false;
      // Cycle guard, matching addLinkedChild's check for each direction.
      return direction === "child"
        ? !isAncestor(n.id, goalEditId, currentNodes)
        : !isAncestor(goalEditId, n.id, currentNodes);
    }).slice(0, 6);
    matches.forEach(n => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = n.title;
      chip.addEventListener("click", () => {
        const ok = direction === "child"
          ? addLinkedChild(goalEditId, n.id)
          : addLinkedChild(n.id, goalEditId);
        if (ok) refreshGoalLinksOrClose();
      });
      suggestionsBox.appendChild(chip);
    });
  });
}

wireLinkAdder(childAddInput, childAddSuggestionsEl, "child");
wireLinkAdder(parentAddInput, parentAddSuggestionsEl, "parent");

function openAddGoalModal(parentId) {
  goalMode = "add";
  goalParentId = parentId || null;
  goalEditId = null;
  resetGoalModalFields();
  modalTitleEl.textContent = goalParentId ? "Add sub-goal" : "Add goal";
  submitBtn.textContent = "Add";
  deleteBtn.hidden = true;
  suggestionsEl.hidden = false;
  linksSectionEl.hidden = true; // link management is edit-only
  modalEl.hidden = false;
  nameInput.focus();
}

function openEditGoalModal(id) {
  const node = currentNodes[id];
  if (!node) return;
  goalMode = "edit";
  goalEditId = id;
  goalParentId = null;
  resetGoalModalFields();
  fillGoalFieldsFromNode(node);
  modalTitleEl.textContent = "Edit goal";
  submitBtn.textContent = "Save";
  deleteBtn.hidden = false;
  suggestionsEl.hidden = true;
  renderGoalLinks(id);
  modalEl.hidden = false;
  nameInput.focus();
}

function closeGoalModal() {
  linksSectionEl.hidden = true;
  modalEl.hidden = true;
  goalParentId = null;
  goalEditId = null;
  goalLinkedExistingId = null;
  goalLinkedSnapshot = null;
}

cancelBtn.addEventListener("click", closeGoalModal);
modalEl.addEventListener("click", e => {
  if (e.target === modalEl) closeGoalModal();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!modalEl.hidden) closeGoalModal();
  if (!resetModalEl.hidden) resetModalEl.hidden = true;
});

nameInput.addEventListener("input", () => {
  if (goalMode !== "add") return;
  const q = nameInput.value.trim().toLowerCase();
  // Clearing the name unlinks; other edits keep the link and will edit the
  // linked goal on submit.
  if (goalLinkedExistingId && !q) {
    goalLinkedExistingId = null;
    goalLinkedSnapshot = null;
    linkNoticeEl.hidden = true;
  }
  suggestionsEl.innerHTML = "";
  if (q.length < 2) return;
  const matches = Object.values(currentNodes)
    .filter(n => n.id !== goalParentId && n.title.toLowerCase().includes(q))
    .slice(0, 6);
  matches.forEach(n => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = n.title;
    chip.addEventListener("click", () => {
      goalLinkedExistingId = n.id;
      fillGoalFieldsFromNode(n);
      goalLinkedSnapshot = JSON.stringify(currentGoalFields());
      // Under a parent the pick links the goal in as a prerequisite; at the top
      // level there is nothing to link into, so it just edits the existing goal.
      linkNoticeEl.textContent = goalParentId
        ? "✓ This will link the existing goal here instead of creating a duplicate, and completing it anywhere completes it everywhere. Change any field to update the linked goal, or clear the name to unlink."
        : "✓ This matches an existing goal. Submitting will edit that goal instead of creating a duplicate. Clear the name to start fresh.";
      linkNoticeEl.hidden = false;
      suggestionsEl.innerHTML = "";
    });
    suggestionsEl.appendChild(chip);
  });
});

modalForm.addEventListener("submit", e => {
  e.preventDefault();
  errorEl.hidden = true;

  // Wrap the whole submit so a combined link+edit (or create) counts as one
  // undoable action; the inner addLinkedChild/saveGoalEdit/addCustomChild
  // calls collapse into this via withUndo's re-entrancy guard.
  const submitLabel = goalMode === "edit" ? "Edited goal"
    : goalLinkedExistingId ? (goalParentId ? "Linked goal" : "Edited goal")
    : "Created goal";
  let aborted = false;
  withUndo(submitLabel, () => {
    if (goalMode === "add") {
      if (goalLinkedExistingId) {
        // Under a parent, link the existing goal in as a prerequisite. At the top
        // level there is no parent to link into, so just edit the existing goal.
        if (goalParentId) {
          const ok = addLinkedChild(goalParentId, goalLinkedExistingId);
          if (!ok) {
            linkNoticeEl.hidden = true;
            errorEl.hidden = false;
            errorEl.textContent = "Can't link that here — it would create a loop (that goal is an ancestor of this one).";
            aborted = true;
            return;
          }
        }
        // If the user changed anything after picking the suggestion, apply those
        // changes to the linked goal.
        const fields = currentGoalFields();
        if (fields.title && goalLinkedSnapshot && JSON.stringify(fields) !== goalLinkedSnapshot) {
          saveGoalEdit(goalLinkedExistingId, fields);
        }
      } else {
        const title = nameInput.value.trim();
        if (!title) { aborted = true; return; }
        addCustomChild(goalParentId, title, {
          type: typeSelect.value,
          iconQuery: iconQueryInput.value.trim(),
          linkQuery: linkQueryInput.value.trim(),
          linkDisabled: linkDisabledCheckbox.checked,
          description: descriptionInput.value.trim()
        });
      }
    } else if (goalMode === "edit") {
      const title = nameInput.value.trim();
      if (!title || !goalEditId) { aborted = true; return; }
      saveGoalEdit(goalEditId, currentGoalFields());
    }
  });
  if (aborted) return;
  closeGoalModal();
});

deleteBtn.addEventListener("click", () => {
  if (!goalEditId) return;
  removeGoal(goalEditId);
  closeGoalModal();
});

function addCustomChild(parentId, title, opts) {
  withUndo("Created goal", () => {
    const id = uid();
    state.customNodes[id] = { id, parentId: parentId || null, title, type: opts.type || "other" };
    if (opts.iconQuery) state.customNodes[id].iconQuery = opts.iconQuery;
    if (opts.linkQuery) state.customNodes[id].linkQuery = opts.linkQuery;
    if (opts.description) state.customNodes[id].description = opts.description;
    state.customNodes[id].linkDisabled = !!opts.linkDisabled;
    if (parentId) state.collapsed[parentId] = false;
    saveState();
    render();
    resolveAndStoreIconLink(id, true, opts.type || "other", opts.iconQuery || title, opts.linkDisabled ? null : (opts.linkQuery || title));
  });
}

// Resolves icon/link for a node and persists the result, keyed off `type`:
// skill and quest are deterministic (no network); "other" uses a wiki search.
// `isCustom` picks state.customNodes vs state.overrides as the write target.
function resolveAndStoreIconLink(id, isCustom, type, iconQuery, linkQuery) {
  const target = isCustom ? state.customNodes[id] : (state.overrides[id] = state.overrides[id] || {});
  if (!target) return;
  const stillExists = () => (isCustom ? state.customNodes[id] : state.overrides[id]);

  if (type === "skill") {
    const skill = detectSkillName(iconQuery || linkQuery || "");
    if (skill) {
      target.iconUrl = WIKI_ICON_BASE + skill + "_icon.png";
      if (linkQuery !== null) { target.link = ironmanGuideLink(skill); target.note = "Ironman Guide: " + skill; }
    }
    if (linkQuery === null) target.link = null;
    saveState();
    render();
    return;
  }

  if (type === "quest") {
    target.iconUrl = WIKI_ICON_BASE + "Quest_point_icon.png";
    if (linkQuery === null) {
      target.link = null;
    } else if (linkQuery) {
      target.link = `https://oldschool.runescape.wiki/w/${encodeURIComponent(linkQuery.trim().replace(/ /g, "_"))}`;
      target.note = null;
    }
    saveState();
    render();
    return;
  }

  if (iconQuery) {
    fetchWikiInfo(iconQuery).then(info => {
      if (info.iconUrl && stillExists()) { target.iconUrl = info.iconUrl; saveState(); render(); }
    });
  }
  if (linkQuery) {
    fetchWikiInfo(linkQuery).then(info => {
      if (info.link && stillExists()) { target.link = info.link; saveState(); render(); }
    });
  } else if (linkQuery === null) {
    target.link = null;
    saveState();
    render();
  }
}

function saveGoalEdit(id, fields) {
  withUndo("Edited goal", () => {
    const node = currentNodes[id];
    const isCustom = !!node.custom;
    const target = isCustom ? state.customNodes[id] : (state.overrides[id] = state.overrides[id] || {});

    const typeChanged = fields.type !== node.type;
    target.title = fields.title;
    target.type = fields.type;
    target.iconQuery = fields.iconQuery || undefined;
    target.linkQuery = fields.linkQuery || undefined;
    target.linkDisabled = fields.linkDisabled;
    target.description = fields.description || undefined;
    if (fields.linkDisabled) target.link = null;

    saveState();
    render();

    // Skill/quest resolution is deterministic, so always safe to (re)apply. For
    // "other", built-in goals keep their curated icon/link unless the user typed
    // an explicit override; custom goals always re-resolve.
    const hadIcon = !!(node.iconUrl || (typeof resolveIconFile === "function" && resolveIconFile(node)));
    const hadLink = !!node.link;
    const iconQuery = fields.type !== "other" ? (fields.iconQuery || fields.title)
      : fields.iconQuery || (isCustom || !hadIcon || typeChanged ? fields.title : "");
    const linkQuery = fields.linkDisabled ? null
      : fields.type !== "other" ? (fields.linkQuery || fields.title)
      : fields.linkQuery || (isCustom || !hadLink || typeChanged ? fields.title : "");
    resolveAndStoreIconLink(id, isCustom, fields.type, iconQuery, linkQuery);
  });
}

function removeGoal(id) {
  const node = currentNodes[id];
  if (!node) return;
  withUndo("Deleted goal", () => {
    if (node.custom) {
      delete state.customNodes[id];
    } else {
      state.removed[id] = true;
      delete state.overrides[id];
    }
    delete state.done[id];
    if (state.rootGoals) delete state.rootGoals[id];
    saveState();
    render();
  });
}

// Returns true on success, false if it would create a cycle.
function addLinkedChild(parentId, existingId) {
  return withUndo("Linked goal", () => {
    if (isAncestor(existingId, parentId, currentNodes)) return false;
    addToLinkedEdges(parentId, existingId);
    state.collapsed[parentId] = false;
    saveState();
    render();
    return true;
  });
}

// --- Filter / toolbar ---------------------------------------------------------

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  const nodeEls = chartEl.querySelectorAll(".graph-node");
  const edgeEls = chartEl.querySelectorAll(".edge");
  if (!q) {
    nodeEls.forEach(n => n.classList.remove("dimmed"));
    edgeEls.forEach(e => e.classList.remove("dimmed"));
    return;
  }
  const matched = new Set();
  nodeEls.forEach(n => {
    const match = n.dataset.title.includes(q);
    n.classList.toggle("dimmed", !match);
    if (match) matched.add(n.dataset.id);
  });
  edgeEls.forEach(e => {
    const ok = matched.has(e.dataset.from) || matched.has(e.dataset.to);
    e.classList.toggle("dimmed", !ok);
  });
}

searchEl.addEventListener("input", applyFilter);

document.getElementById("expandAll").addEventListener("click", () => {
  const { nodes } = getGraph();
  Object.values(nodes).forEach(n => {
    if (n.childIds.length > 0) state.collapsed[n.id] = false;
  });
  saveState();
  render();
});

document.getElementById("collapseAll").addEventListener("click", () => {
  state.collapsed = {};
  saveState();
  render();
});

const hideCompletedBtnEl = document.getElementById("hideCompletedBtn");
const hideIncompleteBtnEl = document.getElementById("hideIncompleteBtn");

hideCompletedBtnEl.addEventListener("click", () => {
  hideCompleted = !hideCompleted;
  hideCompletedBtnEl.classList.toggle("active", hideCompleted);
  hideCompletedBtnEl.textContent = hideCompleted ? "Show completed" : "Hide completed";
  render();
});

hideIncompleteBtnEl.addEventListener("click", () => {
  hideIncomplete = !hideIncomplete;
  hideIncompleteBtnEl.classList.toggle("active", hideIncomplete);
  hideIncompleteBtnEl.textContent = hideIncomplete ? "Show incomplete" : "Hide incomplete";
  render();
});

const resetModalEl = document.getElementById("resetModal");
const resetConfirmBtn = document.getElementById("resetConfirm");
const resetCancelBtn = document.getElementById("resetCancel");

document.getElementById("resetAll").addEventListener("click", () => {
  resetModalEl.hidden = false;
});

resetCancelBtn.addEventListener("click", () => { resetModalEl.hidden = true; });
resetModalEl.addEventListener("click", e => {
  if (e.target === resetModalEl) resetModalEl.hidden = true;
});
resetConfirmBtn.addEventListener("click", () => {
  state = defaultState();
  saveState();
  resetModalEl.hidden = true;
  render();
});

// --- Profile UI ----------------------------------------------------------------

const profileSelectEl = document.getElementById("profileSelect");
const profileDeleteBtnEl = document.getElementById("profileDeleteBtn");
const profileNewBtnEl = document.getElementById("profileNewBtn");
const profileRenameBtnEl = document.getElementById("profileRenameBtn");
const profileExportBtnEl = document.getElementById("profileExportBtn");
const profileImportBtnEl = document.getElementById("profileImportBtn");
const profileImportInputEl = document.getElementById("profileImportInput");

const profileNameModalEl = document.getElementById("profileNameModal");
const profileNameFormEl = document.getElementById("profileNameForm");
const profileNameModalTitleEl = document.getElementById("profileNameModalTitle");
const profileNameInputEl = document.getElementById("profileNameInput");
const profileNameSubmitEl = document.getElementById("profileNameSubmit");
const profileNameCancelEl = document.getElementById("profileNameCancel");

const profileDeleteModalEl = document.getElementById("profileDeleteModal");
const profileDeleteTextEl = document.getElementById("profileDeleteText");
const profileDeleteConfirmEl = document.getElementById("profileDeleteConfirm");
const profileDeleteCancelEl = document.getElementById("profileDeleteCancel");

let profileNameMode = "new"; // "new" | "rename"

profileSelectEl.addEventListener("change", () => switchProfile(profileSelectEl.value));

profileNewBtnEl.addEventListener("click", () => {
  profileNameMode = "new";
  profileNameModalTitleEl.textContent = "New profile";
  profileNameSubmitEl.textContent = "Create";
  profileNameInputEl.value = "";
  profileNameModalEl.hidden = false;
  profileNameInputEl.focus();
});

profileRenameBtnEl.addEventListener("click", () => {
  profileNameMode = "rename";
  profileNameModalTitleEl.textContent = "Rename profile";
  profileNameSubmitEl.textContent = "Save";
  profileNameInputEl.value = profilesMeta.profiles[profilesMeta.activeId].name;
  profileNameModalEl.hidden = false;
  profileNameInputEl.focus();
});

function closeProfileNameModal() { profileNameModalEl.hidden = true; }
profileNameCancelEl.addEventListener("click", closeProfileNameModal);
profileNameModalEl.addEventListener("click", e => { if (e.target === profileNameModalEl) closeProfileNameModal(); });

profileNameFormEl.addEventListener("submit", e => {
  e.preventDefault();
  const name = profileNameInputEl.value.trim();
  if (!name) return;
  if (profileNameMode === "new") createProfile(name);
  else renameProfile(profilesMeta.activeId, name);
  closeProfileNameModal();
});

profileDeleteBtnEl.addEventListener("click", () => {
  if (Object.keys(profilesMeta.profiles).length <= 1) return;
  profileDeleteTextEl.textContent = `Delete profile "${profilesMeta.profiles[profilesMeta.activeId].name}" and all of its progress? This cannot be undone.`;
  profileDeleteModalEl.hidden = false;
});

function closeProfileDeleteModal() { profileDeleteModalEl.hidden = true; }
profileDeleteCancelEl.addEventListener("click", closeProfileDeleteModal);
profileDeleteModalEl.addEventListener("click", e => { if (e.target === profileDeleteModalEl) closeProfileDeleteModal(); });
profileDeleteConfirmEl.addEventListener("click", () => {
  deleteProfile(profilesMeta.activeId);
  closeProfileDeleteModal();
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!profileNameModalEl.hidden) closeProfileNameModal();
  if (!profileDeleteModalEl.hidden) closeProfileDeleteModal();
});

// --- Profile export / import -----------------------------------------------------
// Export downloads the active profile as a JSON file; import loads such a file
// into a brand-new profile (running save-data migrations), so profiles can be
// moved between browsers or kept as backups.

profileExportBtnEl.addEventListener("click", () => {
  const name = profilesMeta.profiles[profilesMeta.activeId].name;
  const payload = {
    app: "iron-tracker",
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "iron-tracker-" + (name.replace(/[^\w-]+/g, "_") || "profile") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});

profileImportBtnEl.addEventListener("click", () => profileImportInputEl.click());

profileImportInputEl.addEventListener("change", async () => {
  const file = profileImportInputEl.files && profileImportInputEl.files[0];
  profileImportInputEl.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const data = payload && payload.state;
    if (!data || typeof data !== "object" || payload.app !== "iron-tracker") {
      throw new Error("not an Iron Tracker profile file");
    }
    const migrated = migrateStateData(data);
    const baseName = (payload.name || file.name.replace(/\.json$/i, "")).trim() || "Imported";
    const names = new Set(Object.values(profilesMeta.profiles).map(p => p.name));
    let name = baseName, i = 2;
    while (names.has(name)) name = `${baseName} (${i++})`;
    const id = "p" + Date.now();
    profilesMeta.profiles[id] = { name };
    profilesMeta.activeId = id;
    localStorage.setItem(storageKeyFor(id), JSON.stringify(migrated));
    saveProfilesMeta();
    state = loadState();
    clearUndo();
    refreshProfileSelect();
    render();
    showToast(`Imported profile "${name}"`);
  } catch (e) {
    showToast("Import failed: " + e.message);
  }
});

// --- Hiscores sync --------------------------------------------------------------
// Fetches a player's skill levels through a CORS proxy (the hiscores endpoint
// has no CORS headers) and marks auto-tracked skill goals done once the required
// level is reached. Local dev via server.py exposes a same-origin proxy at
// /api/hiscores; static hosting (e.g. GitHub Pages) uses the Cloudflare Worker.
const HISCORES_WORKER_URL = "https://osrs-hiscores.nachodelavega97.workers.dev";

function hiscoresEndpoint(username) {
  const q = "player=" + encodeURIComponent(username);
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isLocal ? `/api/hiscores?${q}` : `${HISCORES_WORKER_URL}/?${q}`;
}

async function fetchHiscores(username) {
  const res = await fetch(hiscoresEndpoint(username));
  let data = null;
  try { data = await res.json(); } catch (e) { /* fall through to error below */ }
  if (!res.ok || !data || !data.skills) {
    const msg = (data && data.error) || `Lookup failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const levels = {};
  data.skills.forEach(s => { if (s.name !== "Overall") levels[s.name] = s.level; });
  return levels;
}

function applySkillSync(levels) {
  let changed = 0;
  Object.values(currentNodes).forEach(node => {
    if (state.done[node.id] || !isAutoTrackedSkill(node)) return;
    const req = parseSkillRequirement(node.title);
    const have = req && levels[req.skill];
    if (have != null && have >= req.level) {
      state.done[node.id] = true;
      changed++;
    }
  });
  return changed;
}

const rsnInputEl = document.getElementById("rsnInput");
const syncStatsBtnEl = document.getElementById("syncStatsBtn");
const syncStatusTextEl = document.getElementById("syncStatusText");

rsnInputEl.value = state.username || "";
rsnInputEl.addEventListener("change", () => {
  state.username = rsnInputEl.value.trim();
  saveState();
});

syncStatsBtnEl.addEventListener("click", async () => {
  const username = rsnInputEl.value.trim();
  if (!username) {
    syncStatusTextEl.textContent = "Enter a username first";
    syncStatusTextEl.className = "sync-status error";
    return;
  }
  state.username = username;
  saveState();
  syncStatusTextEl.textContent = "Looking up…";
  syncStatusTextEl.className = "sync-status";
  syncStatsBtnEl.disabled = true;
  try {
    const levels = await fetchHiscores(username);
    const changed = applySkillSync(levels);
    saveState();
    render();
    syncStatusTextEl.textContent = changed
      ? `Synced — ${changed} skill goal${changed === 1 ? "" : "s"} completed`
      : "Synced — no new goals completed";
    syncStatusTextEl.className = "sync-status success";
  } catch (e) {
    syncStatusTextEl.textContent = e.message || "Sync failed";
    syncStatusTextEl.className = "sync-status error";
  } finally {
    syncStatsBtnEl.disabled = false;
  }
});

window.addEventListener("error", e => {
  console.error("Uncaught error:", e.error || e.message);
});
window.addEventListener("unhandledrejection", e => {
  console.error("Unhandled promise rejection:", e.reason);
});

refreshProfileSelect();
render();
