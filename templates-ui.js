
// --- Template updates ------------------------------------------------------------
// A profile is pinned to a template version (its base snapshot, see baseKeyFor).
// When the live template's version is higher, a banner offers to review the diff
// and adopt the new content, or to ignore the update for this version.

// Is there a pending update for this profile? Internal templates never warn.
function templateUpdateInfo(profileId) {
  const p = profilesMeta.profiles[profileId];
  if (!p) return null;
  const t = Templates.getTemplate(p.templateId);
  if (!t || t.internal) return null;
  const cur = t.version || 1;
  const pinned = p.templateVersion || 1;
  if (cur <= pinned) return null;
  if (p.dismissedVersion === cur) return null;
  return { template: t, from: pinned, to: cur };
}

// Flatten a template's goalData to id -> { title, parent-id } for diffing.
function flattenTemplateData(content) {
  const map = {};
  (function walk(list, parent) {
    (list || []).forEach(n => {
      if (!n || !n.id) return;
      if (!(n.id in map)) map[n.id] = { title: n.title || n.id, parent: parent };
      walk(n.children, n.id);
    });
  })(content && content.goalData, null);
  return map;
}

// Compute the changes applying `newC` over `oldC` would make: added / removed /
// moved (reparented) goals, and groups new to the template.
function diffTemplates(oldC, newC) {
  const oldMap = flattenTemplateData(oldC), newMap = flattenTemplateData(newC);
  const titleOf = (map, id) => (id == null ? "top level" : (map[id] ? map[id].title : id));
  const added = [], removed = [], moved = [];
  Object.keys(newMap).forEach(id => { if (!(id in oldMap)) added.push(newMap[id].title); });
  Object.keys(oldMap).forEach(id => {
    if (!(id in newMap)) { removed.push(oldMap[id].title); return; }
    if (oldMap[id].parent !== newMap[id].parent) {
      moved.push({ title: newMap[id].title, from: titleOf(oldMap, oldMap[id].parent), to: titleOf(newMap, newMap[id].parent) });
    }
  });
  const sig = g => (g || []).slice().sort().join("|");
  const oldSigs = new Set(((oldC && oldC.gearGroups) || []).map(sig));
  const newGroups = [];
  ((newC && newC.gearGroups) || []).forEach(g => {
    if (oldSigs.has(sig(g))) return;
    newGroups.push((g || []).map(mid => (newMap[mid] ? newMap[mid].title : mid)));
  });
  return { added, removed, moved, newGroups };
}

function renderTemplateBanner() {
  const el = document.getElementById("templateUpdateBanner");
  if (!el) return;
  const info = templateUpdateInfo(profilesMeta.activeId);
  if (!info) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = "";
  const text = document.createElement("span");
  text.className = "template-banner-text";
  text.textContent = `The "${info.template.name}" template was updated (v${info.from} → v${info.to}).`;
  const actions = document.createElement("div");
  actions.className = "template-banner-actions";
  const review = document.createElement("button");
  review.className = "primary";
  review.textContent = "Review update";
  review.addEventListener("click", () => openTemplateChangesModal(profilesMeta.activeId));
  const ignore = document.createElement("button");
  ignore.textContent = "Ignore";
  ignore.addEventListener("click", () => ignoreTemplateUpdate(profilesMeta.activeId));
  actions.appendChild(review);
  actions.appendChild(ignore);
  el.appendChild(text);
  el.appendChild(actions);
}

function ignoreTemplateUpdate(profileId) {
  const p = profilesMeta.profiles[profileId];
  const t = Templates.getTemplate(p && p.templateId);
  if (!p || !t) return;
  p.dismissedVersion = t.version || 1;
  saveProfilesMeta();
  renderTemplateBanner();
}

// id -> a signature of the group it belongs to in `gearGroups` (its sorted
// members), or undefined when the id is ungrouped. Used to tell whether a
// template update changed a goal's grouping.
function groupSigMap(gearGroups) {
  const m = {};
  (gearGroups || []).forEach(g => {
    const sig = g.slice().sort().join("|");
    g.forEach(id => { m[id] = sig; });
  });
  return m;
}

// Fold the current template's GEAR_GROUPS into the profile's groupsState.
// ensureGroupsState only seeds once, so without this a template's new groups
// would never appear after an update. Existing groups and the user's own group
// edits are left untouched; a template group is added only when it is genuinely
// new (its member set is not already a group, and none of its members are
// already placed in another group).
function addNewTemplateGroups() {
  ensureGroupsState();
  const gs = state.groupsState;
  const existingSigs = new Set(gs.groupOrder.map(gid => (gs.groups[gid] || []).slice().sort().join("|")));
  const placed = new Set();
  gs.groupOrder.forEach(gid => (gs.groups[gid] || []).forEach(m => placed.add(m)));
  let next = gs.groupOrder.length;
  (typeof GEAR_GROUPS !== "undefined" ? GEAR_GROUPS : []).forEach(g => {
    const members = g.filter(id => currentNodes[id]);
    if (members.length < 2) return;
    if (existingSigs.has(members.slice().sort().join("|"))) return;
    if (members.some(m => placed.has(m))) return;
    let gid;
    do { gid = "g" + next++; } while (gs.groups[gid]);
    gs.groups[gid] = members;
    gs.groupOrder.push(gid);
    members.forEach(m => placed.add(m));
  });
}

// Bring the profile's groupsState in line with a template group change on an
// update. Only goals whose grouping the template actually changed (old signature
// != new) are touched: they are detached from their current save group
// (dissolving a group left with one member), then re-grouped from the new
// template. Goals the template left alone keep the user's own group edits.
function reconcileGroupsFromTemplate(oldGears, newGears) {
  ensureGroupsState();
  const oldMap = groupSigMap(oldGears);
  const newMap = groupSigMap(newGears);
  const ids = new Set(Object.keys(oldMap).concat(Object.keys(newMap)));
  ids.forEach(id => {
    if (!currentNodes[id]) return;
    if (oldMap[id] === newMap[id]) return; // template did not change this grouping
    removeFromGroup(id); // detach; a group re-formed by the template is re-added below
  });
  addNewTemplateGroups();
}

// Fold a template update into a profile's base WITHOUT dropping goals the base
// has beyond the template. Goals the template also defines are replaced by the
// template's copy in place (so field changes like a new type or icon are adopted
// and order is preserved); goals only the base has (e.g. a full sub-tree the user
// merged in, or their own additions) are kept; brand-new template goals are
// appended. Groups are unioned by member signature. Without this, updating a
// profile whose base is a superset of the template (a merged base) would wipe
// everything the template omits — silently deleting sub-trees and orphaning any
// custom goals hung off them.
function mergeTemplateUpdateBase(oldBase, tpl) {
  const clone = v => JSON.parse(JSON.stringify(v));
  const tplById = {};
  (function walk(list) { (list || []).forEach(n => { if (n && n.id) { tplById[n.id] = n; walk(n.children); } }); })(tpl.goalData);
  const baseIds = flattenTemplateIds(oldBase);
  const goalData = ((oldBase && oldBase.goalData) || [])
    .map(n => (n && n.id && tplById[n.id]) ? clone(tplById[n.id]) : clone(n));
  ((tpl && tpl.goalData) || []).forEach(n => { if (n && n.id && !baseIds[n.id]) goalData.push(clone(n)); });
  // Groups follow the template: the tier layout is the template's, and the user's
  // own group edits live in state.groupsState (reconcileGroupsFromTemplate applies
  // template group add/removes to it). Unioning here would resurrect a group the
  // template just dropped, so take the template's gearGroups as-is.
  const gearGroups = ((tpl && tpl.gearGroups) || []).map(g => g.slice());
  return { goalData, gearGroups };
}

function applyTemplateUpdate(profileId) {
  const p = profilesMeta.profiles[profileId];
  const t = Templates.getTemplate(p && p.templateId);
  if (!p || !t) return;
  const oldBase = loadTemplateBase(profileId) || { goalData: [], gearGroups: [] };

  // The update is reversible: undo restores `state` (progress) and this closure
  // rolls back the bits outside `state` the update touched — the version pin, the
  // dismissed-version flag, and the stored base snapshot.
  const beforeMeta = { templateVersion: p.templateVersion, dismissedVersion: p.dismissedVersion };
  const restore = () => {
    const pr = profilesMeta.profiles[profileId];
    if (!pr) return;
    pr.templateVersion = beforeMeta.templateVersion;
    if (beforeMeta.dismissedVersion === undefined) delete pr.dismissedVersion;
    else pr.dismissedVersion = beforeMeta.dismissedVersion;
    saveTemplateBase(profileId, oldBase);
    saveProfilesMeta();
    applyProfileTemplate(profileId);
    render();
    renderTemplateBanner();
  };

  withUndo(`Updated to "${t.name}" v${t.version || 1}`, () => {
    const newBase = mergeTemplateUpdateBase(oldBase, t);
    saveTemplateBase(profileId, newBase);
    p.templateVersion = t.version || 1;
    delete p.dismissedVersion;
    saveProfilesMeta();
    if (profileId === profilesMeta.activeId) {
      applyProfileTemplate(profileId);
      render();  // rebuild currentNodes from the new template content
      reconcileGroupsFromTemplate(oldBase.gearGroups, t.gearGroups);
      saveState();
      render();
    } else {
      renderTemplateBanner();
    }
  }, { force: true, restore });
  renderTemplateBanner();
}

const templateChangesModalEl = document.getElementById("templateChangesModal");
const templateChangesBodyEl = document.getElementById("templateChangesBody");
const templateChangesTitleEl = document.getElementById("templateChangesTitle");
const templateChangesConfirmEl = document.getElementById("templateChangesConfirm");
const templateChangesCancelEl = document.getElementById("templateChangesCancel");
const templateChangesBackupEl = document.getElementById("templateChangesBackup");

function closeTemplateChangesModal() { if (templateChangesModalEl) templateChangesModalEl.hidden = true; }

function openTemplateChangesModal(profileId) {
  const p = profilesMeta.profiles[profileId];
  const t = Templates.getTemplate(p && p.templateId);
  if (!p || !t || !templateChangesModalEl) return;
  const base = loadTemplateBase(profileId) || { goalData: [], gearGroups: [] };
  const diff = diffTemplates(base, { goalData: t.goalData, gearGroups: t.gearGroups });
  templateChangesTitleEl.textContent = `Update "${t.name}" to v${t.version || 1}`;
  templateChangesBodyEl.innerHTML = "";

  const section = (title, items, format) => {
    if (!items.length) return;
    const h = document.createElement("h3");
    h.className = "template-changes-heading";
    h.textContent = `${title} (${items.length})`;
    const ul = document.createElement("ul");
    ul.className = "template-changes-list";
    items.forEach(it => {
      const li = document.createElement("li");
      li.textContent = format(it);
      ul.appendChild(li);
    });
    templateChangesBodyEl.appendChild(h);
    templateChangesBodyEl.appendChild(ul);
  };

  section("New goals", diff.added, x => x);
  section("Deleted goals", diff.removed, x => x);
  section("Moved goals", diff.moved, m => `${m.title}: ${m.from} → ${m.to}`);
  section("New groups", diff.newGroups, g => g.join(", "));

  if (!diff.added.length && !diff.removed.length && !diff.moved.length && !diff.newGroups.length) {
    const pnone = document.createElement("p");
    pnone.className = "modal-body-text";
    pnone.textContent = "No goal or group changes; only the template version changed.";
    templateChangesBodyEl.appendChild(pnone);
  }

  templateChangesConfirmEl.onclick = () => { applyTemplateUpdate(profileId); closeTemplateChangesModal(); };
  if (templateChangesBackupEl) templateChangesBackupEl.onclick = () => exportProfile(profileId);
  templateChangesModalEl.hidden = false;
}

if (templateChangesCancelEl) templateChangesCancelEl.addEventListener("click", closeTemplateChangesModal);
if (templateChangesModalEl) templateChangesModalEl.addEventListener("click", e => { if (e.target === templateChangesModalEl) closeTemplateChangesModal(); });

// --- Apply a template to the current profile -------------------------------------
// Driven from the Templates hub ("Use in this profile"). "merge" adds the
// template's goals on top of the current chart; "replace" swaps the profile's
// template content for the selected one. Either way the profile is re-pinned to
// the selected template. The save's own progress, hidden goals, and custom goals
// are kept: progress is keyed by goal id, so it survives on every goal the new
// template shares.

// The active profile's live goal data, used as the merge base when it has no
// stored snapshot (an internal "__full__" profile renders the live tree).
function currentContentSnapshot() {
  return {
    goalData: (typeof GOAL_DATA !== "undefined" ? GOAL_DATA : []),
    gearGroups: (typeof GEAR_GROUPS !== "undefined" ? GEAR_GROUPS : [])
  };
}

function flattenTemplateIds(content) {
  const set = {};
  (function walk(list) {
    (list || []).forEach(n => { if (n && n.id) { set[n.id] = true; walk(n.children); } });
  })(content && content.goalData);
  return set;
}

// Union of two template snapshots: keep the base as-is and append the incoming
// template's top-level goals and gear groups the base does not already have.
function mergeTemplateContent(base, add) {
  const ids = flattenTemplateIds(base);
  const goalData = ((base && base.goalData) || []).slice();
  ((add && add.goalData) || []).forEach(n => {
    if (n && n.id && !ids[n.id]) { goalData.push(JSON.parse(JSON.stringify(n))); ids[n.id] = true; }
  });
  const sig = g => (g || []).slice().sort().join("|");
  const baseSigs = new Set(((base && base.gearGroups) || []).map(sig));
  const gearGroups = ((base && base.gearGroups) || []).slice();
  ((add && add.gearGroups) || []).forEach(g => { if (!baseSigs.has(sig(g))) gearGroups.push(g.slice()); });
  return { goalData, gearGroups };
}

function changeProfileTemplate(profileId, templateId, mode) {
  const p = profilesMeta.profiles[profileId];
  const t = Templates.getTemplate(templateId);
  if (!p || !t || t.internal) return;

  // Undo has to roll back more than `state`: the profile's pin, its stored base
  // snapshot, and the global GOAL_DATA the chart renders from.
  const beforeMeta = { templateId: p.templateId, templateVersion: p.templateVersion, dismissedVersion: p.dismissedVersion };
  const beforeBase = loadTemplateBase(profileId);
  const restore = () => {
    const pr = profilesMeta.profiles[profileId];
    if (!pr) return;
    pr.templateId = beforeMeta.templateId;
    pr.templateVersion = beforeMeta.templateVersion;
    if (beforeMeta.dismissedVersion === undefined) delete pr.dismissedVersion;
    else pr.dismissedVersion = beforeMeta.dismissedVersion;
    if (beforeBase) saveTemplateBase(profileId, beforeBase);
    else localStorage.removeItem(baseKeyFor(profileId));
    saveProfilesMeta();
    applyProfileTemplate(profileId);
    refreshProfileSelect();
    renderTemplateBanner();
  };

  const label = mode === "merge" ? `Added "${t.name}"` : `Replaced template with "${t.name}"`;
  withUndo(label, () => {
    let base;
    if (mode === "merge") {
      const current = loadTemplateBase(profileId) || currentContentSnapshot();
      base = mergeTemplateContent(current, { goalData: t.goalData, gearGroups: t.gearGroups });
    } else {
      base = { goalData: t.goalData, gearGroups: t.gearGroups };
    }
    saveTemplateBase(profileId, base);
    p.templateId = t.id;
    p.templateVersion = t.version || 1;
    delete p.dismissedVersion;
    saveProfilesMeta();
    applyProfileTemplate(profileId);
    render();               // rebuild currentNodes from the new base content
    addNewTemplateGroups(); // then adopt any groups the template added
    saveState();
    render();
    refreshProfileSelect();
    renderTemplateBanner();
  }, { force: true, restore });
}

// --- Template management ---------------------------------------------------------
// Add or remove new-profile templates. Built-in templates (Empty, Ladlor) are
// read-only; user templates are imported from JSON files and stored in
// localStorage. Removing a template never touches profiles already created from
// it (their saved state is self-contained).

const manageTemplatesBtnEl = document.getElementById("manageTemplatesBtn");
const templatesModalEl = document.getElementById("templatesModal");
const templatesListEl = document.getElementById("templatesList");
const templatesCloseBtnEl = document.getElementById("templatesCloseBtn");
const templateImportBtnEl = document.getElementById("templateImportBtn");
const templateImportInputEl = document.getElementById("templateImportInput");
const templatePasteBtnEl = document.getElementById("templatePasteBtn");
const templateNewNameEl = document.getElementById("templateNewName");
const templateFromProfileBtnEl = document.getElementById("templateFromProfileBtn");

// Serialize the active profile's current chart into a template (goalData +
// gearGroups). Reads the final graph (removals, edge edits and custom nodes all
// applied), so the template starts a new profile from exactly what's on screen.
function templateFromCurrentProfile(name) {
  const { nodes } = getGraph();
  ensureGroupsState();
  const emitted = {};
  function serialize(id) {
    const n = nodes[id];
    if (!n) return null;
    const node = { id: n.id, title: n.title, type: n.type || "other" };
    if (n.shared) node.shared = n.shared;
    if (n.icon) node.icon = n.icon;
    if (n.iconUrl) node.iconUrl = n.iconUrl;
    if (n.link) node.link = n.link;
    if (n.note) node.note = n.note;
    if (n.description) node.description = n.description;
    node.children = [];
    (n.childIds || []).forEach(cid => {
      if (emitted[cid]) return; // a shared/multi-parent node is emitted once
      emitted[cid] = true;
      const child = serialize(cid);
      if (child) node.children.push(child);
    });
    return node;
  }
  const roots = Object.keys(nodes).filter(id => nodes[id].parentIds.length === 0);
  roots.forEach(id => { emitted[id] = true; });
  const goalData = roots.map(serialize).filter(Boolean);
  const gearGroups = (state.groupsState.groupOrder || [])
    .map(gid => (state.groupsState.groups[gid] || []).filter(mid => nodes[mid]))
    .filter(g => g.length);
  return { name: name, goalData: goalData, gearGroups: gearGroups };
}

function downloadTemplate(t) {
  // No id in the exported file: it is an internal handle only, and omitting it
  // means importing (from a file or the clipboard) always creates a new template
  // rather than silently overwriting an existing one.
  const payload = { name: t.name, goalData: t.goalData || [], gearGroups: t.gearGroups || [] };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "iron-tracker-template-" + (t.name.replace(/[^\w-]+/g, "_") || "template") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// "N top-level goals · G groups", so a template's contents are visible before it
// is picked (here and, abbreviated, in the new-profile picker).
function templateSummary(t) {
  const goals = (t.goalData || []).length;
  const groups = (t.gearGroups || []).length;
  return goals + " top-level goal" + (goals === 1 ? "" : "s")
    + " · " + groups + " group" + (groups === 1 ? "" : "s");
}

// Apply a template to the active profile from the hub, then refresh the list so
// its "in use" / update state reflects the change.
function applyTemplateToProfile(t, mode) {
  changeProfileTemplate(profilesMeta.activeId, t.id, mode);
  renderTemplatesList();
}

// Swap a row's action buttons for the merge/replace choice ("Use in this
// profile"). Replace is safe even when the old template is unknown (the base is
// rebuilt from the chosen template), so both are always offered.
function showUsePrompt(actions, t) {
  actions.innerHTML = "";
  const label = document.createElement("span");
  label.className = "templates-use-label";
  label.textContent = "Apply:";
  actions.appendChild(label);
  const add = document.createElement("button");
  add.textContent = "Add on top";
  add.title = "Add this template's goals on top of the current save";
  add.addEventListener("click", () => applyTemplateToProfile(t, "merge"));
  actions.appendChild(add);
  const rep = document.createElement("button");
  rep.textContent = "Replace";
  rep.title = "Replace the current chart with this template (progress is kept, keyed by goal id)";
  rep.addEventListener("click", () => applyTemplateToProfile(t, "replace"));
  actions.appendChild(rep);
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => renderTemplateRowActions(actions, t));
  actions.appendChild(cancel);
}

// Default action buttons for a template row: use here, export, and (user
// templates only) update-from-file and a two-step remove.
function renderTemplateRowActions(actions, t) {
  actions.innerHTML = "";
  const use = document.createElement("button");
  use.textContent = "Use in this profile";
  use.title = "Apply this template to the current profile";
  use.addEventListener("click", () => showUsePrompt(actions, t));
  actions.appendChild(use);
  const dl = document.createElement("button");
  dl.textContent = "Export";
  dl.addEventListener("click", () => downloadTemplate(t));
  actions.appendChild(dl);
  if (!t.builtin) {
    // Re-upload new content to bump this template's version in place, so
    // profiles created from it can adopt the update via the banner and hub.
    const upd = document.createElement("button");
    upd.textContent = "Update from file";
    upd.title = "Replace this template's content from a JSON file and bump its version";
    upd.addEventListener("click", () => updateTemplateFromFile(t));
    actions.appendChild(upd);
    // Two-step confirm: the first click arms the button, a second click within
    // a few seconds actually removes it (reverts otherwise).
    const rm = document.createElement("button");
    rm.className = "danger";
    rm.textContent = "Remove";
    let armed = false, armTimer = null;
    rm.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        rm.textContent = "Confirm remove";
        rm.classList.add("confirming");
        armTimer = setTimeout(() => {
          armed = false;
          rm.textContent = "Remove";
          rm.classList.remove("confirming");
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      Templates.removeUserTemplate(t.id);
      renderTemplatesList();
      showToast(`Removed template "${t.name}"`);
    });
    actions.appendChild(rm);
  }
}

function renderTemplatesList() {
  templatesListEl.innerHTML = "";
  const activeTid = templateIdFor(profilesMeta.activeId);
  const upd = templateUpdateInfo(profilesMeta.activeId);
  Templates.listTemplates().forEach(t => {
    const li = document.createElement("li");
    li.className = "templates-list-item";

    const info = document.createElement("div");
    info.className = "templates-list-info";

    const name = document.createElement("div");
    name.className = "templates-list-name";
    name.textContent = t.name;
    if (t.builtin) {
      const tag = document.createElement("span");
      tag.className = "templates-tag";
      tag.textContent = "built-in";
      name.appendChild(tag);
    }
    if (t.id === activeTid) {
      const tag = document.createElement("span");
      tag.className = "templates-tag in-use";
      tag.textContent = "in use";
      name.appendChild(tag);
    }
    info.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "templates-list-meta";
    meta.textContent = "v" + (t.version || 1) + " · " + templateSummary(t);
    info.appendChild(meta);

    // The update-available state (was a top-of-page banner only) now surfaces on
    // the affected profile's template row too, with the version numbers kept.
    if (upd && upd.template.id === t.id) {
      const note = document.createElement("div");
      note.className = "templates-update-note";
      const text = document.createElement("span");
      text.textContent = `Update available: v${upd.from} → v${upd.to}`;
      const review = document.createElement("button");
      review.textContent = "Review";
      review.addEventListener("click", () => openTemplateChangesModal(profilesMeta.activeId));
      note.appendChild(text);
      note.appendChild(review);
      info.appendChild(note);
    }

    li.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "templates-list-actions";
    renderTemplateRowActions(actions, t);
    li.appendChild(actions);
    templatesListEl.appendChild(li);
  });
}

function openTemplatesModal() {
  if (templateNewNameEl) templateNewNameEl.value = "";
  renderTemplatesList();
  templatesModalEl.hidden = false;
}
function closeTemplatesModal() { templatesModalEl.hidden = true; }

function addTemplateFromObject(obj, sourceLabel) {
  try {
    const rec = Templates.addUserTemplate(obj);
    renderTemplatesList();
    showToast(`Added template "${rec.name}"`);
  } catch (e) {
    showToast(`Template ${sourceLabel} failed: ` + e.message);
  }
}

// Replace a user template's content from a JSON file, bumping its version so
// profiles pinned to it surface the update banner.
function updateTemplateFromFile(t) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const rec = Templates.updateUserTemplate(t.id, JSON.parse(await file.text()));
      renderTemplatesList();
      renderTemplateBanner();
      showToast(`Updated template "${rec.name}" to v${rec.version}`);
    } catch (e) {
      showToast("Template update failed: " + e.message);
    }
  });
  input.click();
}

if (manageTemplatesBtnEl) manageTemplatesBtnEl.addEventListener("click", openTemplatesModal);
templatesCloseBtnEl.addEventListener("click", closeTemplatesModal);
templatesModalEl.addEventListener("click", e => { if (e.target === templatesModalEl) closeTemplatesModal(); });
templateImportBtnEl.addEventListener("click", () => templateImportInputEl.click());

templateImportInputEl.addEventListener("change", async () => {
  const file = templateImportInputEl.files && templateImportInputEl.files[0];
  templateImportInputEl.value = "";
  if (!file) return;
  try {
    addTemplateFromObject(JSON.parse(await file.text()), "import");
  } catch (e) {
    showToast("Template import failed: " + e.message);
  }
});

templatePasteBtnEl.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error("clipboard not available in this browser");
    }
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) throw new Error("clipboard is empty");
    addTemplateFromObject(JSON.parse(text), "paste");
  } catch (e) {
    showToast("Template paste failed: " + e.message);
  }
});

templateFromProfileBtnEl.addEventListener("click", () => {
  const name = (templateNewNameEl.value || "").trim()
    || profilesMeta.profiles[profilesMeta.activeId].name + " template";
  addTemplateFromObject(templateFromCurrentProfile(name), "save");
  templateNewNameEl.value = "";
});
