
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
  } else if (type === "diary") {
    iconQueryLabel.textContent = "Icon override";
    iconQueryHint.textContent = "(diaries always use the diary icon)";
    iconQueryInput.placeholder = "";
    iconQueryInput.disabled = true;
    linkQueryHint.textContent = "(optional — leave blank to detect the area from the name)";
    linkQueryInput.placeholder = "e.g. Hard Karamja";
  } else {
    iconQueryLabel.textContent = "Icon override";
    iconQueryHint.textContent = "(optional — leave blank to auto-search using the name)";
    iconQueryInput.placeholder = "e.g. Dragon scimitar";
    iconQueryInput.disabled = false;
    linkQueryHint.textContent = "(optional — leave blank to auto-search using the name)";
    linkQueryInput.placeholder = "e.g. Eagles' Peak";
  }
  // Only an item is bought, so only an item carries a cost (currency-ui.js).
  syncGoalCostsVisibility(type);
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
  } else if (type === "diary") {
    setIconPreview(WIKI_ICON_BASE + "Achievement_Diaries.png", null);
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
  } else if (type === "diary") {
    // Preview the resolved area+tier, so it is obvious when the name does not
    // name a real diary (and so will never sync from RuneProfile).
    const diary = typeof parseDiaryGoal === "function" ? parseDiaryGoal({ title: linkQuery }) : null;
    linkPreviewEl.textContent = !diary
      ? "No diary area detected in that text"
      : "→ " + (diary.tier ? diary.tier + " " + diary.area : diary.area + " (no tier — will not sync)");
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
    description: descriptionInput.value.trim(),
    // { currencyId: { name, amount } }, from currency-ui.js.
    costs: currentGoalCosts()
  };
}

function resetGoalModalFields() {
  nameInput.value = "";
  typeSelect.value = "other";
  iconQueryInput.value = "";
  linkQueryInput.value = "";
  linkDisabledCheckbox.checked = false;
  descriptionInput.value = "";
  resetGoalCosts();
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
  fillGoalCosts(node.id);
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
          description: descriptionInput.value.trim(),
          costs: currentGoalCosts()
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
    writeGoalCosts(id, opts.costs, opts.type || "other");
    if (parentId) state.collapsed[parentId] = false;
    saveState();
    render();
    resolveAndStoreIconLink(id, true, opts.type || "other", opts.iconQuery || title, opts.linkDisabled ? null : (opts.linkQuery || title));
  });
}

// Types whose icon/link come from a fuzzy wiki search rather than a deterministic
// rule. "item" behaves exactly like "other" here (it only differs by being bank-
// auto-completable), so both preserve a curated icon/link unless an override is typed.
function isWikiSearchType(type) {
  return type === "other" || type === "item";
}

// Resolves icon/link for a node and persists the result, keyed off `type`:
// skill and quest are deterministic (no network); "other"/"item" use a wiki search.
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

  if (type === "diary") {
    target.iconUrl = WIKI_ICON_BASE + "Achievement_Diaries.png";
    if (linkQuery === null) {
      target.link = null;
    } else {
      const diary = parseDiaryGoal({ title: linkQuery });
      if (diary) { target.link = diaryAreaLink(diary.area, diary.tier); target.note = null; }
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
    writeGoalCosts(id, fields.costs, fields.type);

    saveState();
    render();

    // Skill/quest resolution is deterministic, so always safe to (re)apply. For
    // "other", built-in goals keep their curated icon/link unless the user typed
    // an explicit override; custom goals always re-resolve.
    const hadIcon = !!(node.iconUrl || (typeof resolveIconFile === "function" && resolveIconFile(node)));
    const hadLink = !!node.link;
    const wikiSearch = isWikiSearchType(fields.type);
    const iconQuery = !wikiSearch ? (fields.iconQuery || fields.title)
      : fields.iconQuery || (isCustom || !hadIcon || typeChanged ? fields.title : "");
    const linkQuery = fields.linkDisabled ? null
      : !wikiSearch ? (fields.linkQuery || fields.title)
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
    if (state.costs) delete state.costs[id];
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
