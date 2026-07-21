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
  // another custom node). A custom node whose parent goal is absent from the
  // current template (e.g. after a template swap/trim that dropped the parent) is
  // promoted to a top-level goal rather than dropped, so switching templates can
  // never silently lose a custom sub-goal. Its parentId is kept, so re-adding the
  // parent (switching the template back) re-nests it. A parentless custom goal is
  // likewise a top-level goal.
  Object.values(state.customNodes).forEach(custom => {
    const node = customObjs[custom.id];
    let parent = byId[custom.parentId];
    if (!parent && byShared[custom.parentId] && byShared[custom.parentId].length) {
      parent = byShared[custom.parentId][0];
    }
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
        description: raw.description, diaryArea: raw.diaryArea, diaryTier: raw.diaryTier,
        childIds: [], parentIds: []
      };
      const defaultLink = typeof resolveDefaultLink === "function"
        ? resolveDefaultLink({
            type: effectiveType, title: (ov && ov.title) || raw.title, link: raw.link,
            diaryArea: raw.diaryArea, diaryTier: raw.diaryTier
          })
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

// --- Currencies --------------------------------------------------------------
// A currency is a resource several goals spend (marks of grace, coins). The cost
// lives on the goal that spends it, never on a shared sub-goal node: a shared
// node has one identity, so "Graceful boots needs 40" and "Graceful cape needs
// 40" would read as 40 instead of 80. Summing per-goal costs gives the real 80.
// Costs are advisory: they never gate a checkmark, so the status model stays
// two-state.

function currencySlug(name) {
  return String(name || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Parses an amount typed the way the game shows them: "120k" -> 120000,
// "1.5m" -> 1500000, "2b" -> 2000000000. Plain digits and thousands separators
// work too. Returns null when nothing usable was typed, so callers can tell
// "empty/garbage" from a real 0.
function parseAmount(text) {
  const raw = String(text == null ? "" : text).trim().toLowerCase().replace(/[\s,]/g, "");
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(raw);
  if (!m) return null;
  const mult = m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  const value = Math.round(parseFloat(m[1]) * mult);
  return Number.isFinite(value) ? value : null;
}

// Compact display for amounts that get large (coins): 1500 -> 1.5K, 2000000 -> 2M.
function formatCurrencyAmount(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1000000) return (v / 1000000).toFixed(abs % 1000000 ? 1 : 0).replace(/\.0$/, "") + "M";
  if (abs >= 10000) return (v / 1000).toFixed(abs % 1000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return String(v);
}

// Looks up a currency by name, or mints and registers a new one. Returns its id.
function ensureCurrency(name) {
  const id = currencySlug(name);
  if (!id) return null;
  if (!state.currencies[id]) {
    state.currencies[id] = { id, name: String(name).trim(), bankName: String(name).trim(), held: 0 };
  }
  return id;
}

// What a goal's subtree (itself plus all descendants) still costs, as
// { currencyId: amount }, so a parent shows what finishing the branch takes from
// here. A done goal contributes nothing, which is what makes ticking a sub-goal
// lower its parent's total. Descendants are still walked past a done goal, since
// linking can leave an unfinished goal under a finished one. A goal reachable by
// several paths counts once, and `seen` also makes this safe on the DAG.
function subtreeCosts(id, nodes, memo) {
  if (memo && memo[id]) return memo[id];
  const totals = {};
  const seen = {};
  (function visit(nid) {
    if (seen[nid] || !nodes[nid]) return;
    seen[nid] = true;
    const own = state.done[nid] ? null : (state.costs && state.costs[nid]) || null;
    if (own) {
      Object.keys(own).forEach(cid => {
        const amount = Number(own[cid]) || 0;
        if (amount > 0) totals[cid] = (totals[cid] || 0) + amount;
      });
    }
    nodes[nid].childIds.forEach(visit);
  })(id);
  if (memo) memo[id] = totals;
  return totals;
}

// Aggregates every goal cost into per-currency totals:
// { currencyId: { id, name, bankName, held, required, remaining, goals: [...] } }
// `required` counts every goal in the graph, `remaining` only the not-done ones.
// `nodes` is already pruned, so hidden goals do not contribute.
function currencyTotals(nodes) {
  const out = {};
  const registry = state.currencies || {};
  const costs = state.costs || {};

  function row(cid) {
    if (!out[cid]) {
      const c = registry[cid] || {};
      out[cid] = {
        id: cid, name: c.name || cid, bankName: c.bankName || c.name || cid,
        held: Number(c.held) || 0, required: 0, remaining: 0, goals: []
      };
    }
    return out[cid];
  }

  // node.id is the effectiveId (the map key), so a shared goal is counted once
  // however many parents it has.
  Object.values(nodes).forEach(node => {
    const nodeCosts = costs[node.id];
    if (!nodeCosts) return;
    Object.keys(nodeCosts).forEach(cid => {
      const amount = Number(nodeCosts[cid]) || 0;
      if (amount <= 0) return;
      const r = row(cid);
      const done = !!state.done[node.id];
      r.required += amount;
      if (!done) r.remaining += amount;
      r.goals.push({ id: node.id, title: node.title, amount, done });
    });
  });

  // Registered currencies with no spending goal still show, so one does not
  // vanish from the panel the moment its last goal is hidden or deleted.
  Object.keys(registry).forEach(row);
  Object.values(out).forEach(r => r.goals.sort((a, b) => b.amount - a.amount || a.title.localeCompare(b.title)));
  return out;
}

// --- Icon rendering ----------------------------------------------------------

// Every render rebuilds the whole chart, and a brand new <img> paints blank for
// a frame before its (cached) bitmap decodes, which reads as all the icons
// blinking on each toggle. Keep the built slots around and hand the same
// elements back: re-parenting an already loaded <img> never repaints.
const iconSlotCache = new Map();
let iconSlotUse = new Map();

// Called once per render pass: resets the per-key instance counters and drops
// slots nothing asked for last pass (removed or edited goals).
function beginIconPass() {
  iconSlotCache.forEach((pool, key) => {
    const used = iconSlotUse.get(key) || 0;
    if (used === 0) iconSlotCache.delete(key);
    else if (pool.length > used) pool.length = used;
  });
  iconSlotUse = new Map();
}

// Icon slot for a node: real wiki icon when resolvable, else the type's emoji.
function renderIcon(node, sizeClass) {
  const iconFile = typeof resolveIconFile === "function" ? resolveIconFile(node) : null;
  const iconSrc = node.iconUrl || (iconFile ? WIKI_ICON_BASE + encodeURIComponent(iconFile) : null);
  const key = [node.id, node.type || "", node.title, sizeClass || "", iconSrc || ""].join("|");
  // A node can render twice in one pass (a grouped goal also linked as a
  // child), so each key keeps a pool and every call takes the next free slot.
  const instance = iconSlotUse.get(key) || 0;
  iconSlotUse.set(key, instance + 1);
  const pool = iconSlotCache.get(key) || [];
  if (!pool[instance]) {
    pool[instance] = buildIconSlot(node, sizeClass, iconSrc);
    iconSlotCache.set(key, pool);
  }
  return pool[instance];
}

function buildIconSlot(node, sizeClass, src) {
  const slot = document.createElement("span");
  slot.className = "icon-slot" + (node.type ? " type-" + node.type : "") + (sizeClass ? " " + sizeClass : "");

  const fallbackEmoji = node.type && TYPE_META[node.type] ? TYPE_META[node.type].icon : "";
  const fallbackLabel = node.type && TYPE_META[node.type] ? TYPE_META[node.type].label : "";

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
