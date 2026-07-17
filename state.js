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

// A profile is pinned to a snapshot of the template content (goalData +
// gearGroups) it was created from, stored under its own key. Rendering uses this
// snapshot rather than the live template, so a template update never changes a
// profile's chart until the user reviews and accepts it. Internal templates
// (__full__) are not pinned; those profiles render the live tree.
function baseKeyFor(profileId) {
  return "iron-tracker:tpl-base:" + profileId;
}

function loadTemplateBase(profileId) {
  try {
    const raw = localStorage.getItem(baseKeyFor(profileId));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load template base", profileId, e);
  }
  return null;
}

function saveTemplateBase(profileId, content) {
  localStorage.setItem(baseKeyFor(profileId), JSON.stringify({
    goalData: (content && content.goalData) || [],
    gearGroups: (content && content.gearGroups) || []
  }));
}

let profilesMeta = loadProfilesMeta();

// Point the global goal data at a profile's chosen template before its state is
// built or rendered.
function templateIdFor(profileId) {
  const p = profilesMeta.profiles[profileId];
  return (p && p.templateId) || Templates.DEFAULT_TEMPLATE_ID;
}

function applyProfileTemplate(profileId) {
  const base = loadTemplateBase(profileId);
  if (base) Templates.applyContent(base.goalData, base.gearGroups, templateIdFor(profileId));
  else Templates.applyTemplate(templateIdFor(profileId));
}

// Pin every pre-existing (template-less) profile to a concrete template exactly
// once, so trimming the "ladlor" template to the web-page goals never changes
// what an old profile renders. A profile that already has a saved state predates
// templates and is pinned to "__full__" (the complete historical tree, so its
// progress on herb runs / diaries / quests still shows); a brand-new profile with
// no saved state yet is pinned to "ladlor" (the clean page-only chart).
function ensureProfileTemplates() {
  let changed = false;
  Object.keys(profilesMeta.profiles).forEach(id => {
    const p = profilesMeta.profiles[id];
    if (!p.templateId) {
      const hasSave = localStorage.getItem(storageKeyFor(id)) != null;
      p.templateId = hasSave ? Templates.FULL_TEMPLATE_ID : Templates.DEFAULT_TEMPLATE_ID;
      changed = true;
    }
    // Pin profiles that predate versioning to their template's current content
    // and version, so they render exactly as before and only warn on a future
    // bump. Internal templates (__full__) render the live tree, so leave them
    // unpinned and unversioned.
    const t = Templates.getTemplate(p.templateId) || Templates.getTemplate(Templates.DEFAULT_TEMPLATE_ID);
    const internal = t && t.internal;
    if (!internal && (p.templateVersion == null || localStorage.getItem(baseKeyFor(id)) == null)) {
      p.templateVersion = t ? (t.version || 1) : 1;
      saveTemplateBase(id, t);
      changed = true;
    }
  });
  if (changed) saveProfilesMeta();
}

ensureProfileTemplates();
applyProfileTemplate(profilesMeta.activeId);

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

// New saves start showing exactly the goals their template contains, so nothing
// is removed by default. The "ladlor" template is already trimmed to the
// web-page goals, and pre-existing profiles load their own stored `removed`.
function defaultState() {
  return {
    done: {}, order: {}, customNodes: {}, linkedEdges: {}, removedEdges: {},
    collapsed: {}, overrides: {}, removed: {}, username: "",
    // Uploaded bank memory: { normalizedItemName: quantity }. Used to auto-complete
    // "item" goals by name. No node ids, so it needs no migration remap.
    bank: {},
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
      groupsState: parsed.groupsState || null,
      bank: parsed.bank || {}
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
  applyProfileTemplate(id);
  state = loadState();
  clearUndo();
  refreshProfileSelect();
  render();
}

function createProfile(name, templateId) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  const id = "p" + Date.now();
  const t = Templates.getTemplate(templateId) || Templates.getTemplate(Templates.DEFAULT_TEMPLATE_ID);
  const tpl = t.id;
  profilesMeta.profiles[id] = { name: trimmed, templateId: tpl, templateVersion: t.version || 1 };
  if (!t.internal) saveTemplateBase(id, t);
  profilesMeta.activeId = id;
  saveProfilesMeta();
  applyProfileTemplate(id);
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
  localStorage.removeItem(baseKeyFor(id));
  delete profilesMeta.profiles[id];
  if (profilesMeta.activeId === id) {
    profilesMeta.activeId = Object.keys(profilesMeta.profiles)[0];
    applyProfileTemplate(profilesMeta.activeId);
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

// opts (optional): { force, restore }. `force` offers the undo even when `state`
// is byte-identical (a template swap changes the chart via GOAL_DATA / the pinned
// base, not always via `state`). `restore` runs during undo to roll back the
// non-`state` bits the action touched (profile pin + base snapshot + globals).
function withUndo(label, fn, opts) {
  if (undoActive) return fn(); // nested; the outermost action owns the undo
  undoActive = true;
  const before = JSON.stringify(state);
  let result;
  try { result = fn(); } finally { undoActive = false; }
  if (JSON.stringify(state) !== before || (opts && opts.force)) {
    undoData = { before, label, restore: (opts && opts.restore) || null };
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
  const restore = undoData.restore;
  state = JSON.parse(undoData.before);
  undoData = null;
  dismissUndoToast();
  if (restore) restore(); // roll back pin/base/globals before rebuilding the chart
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

