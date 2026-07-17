
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
const profileTemplateRowEl = document.getElementById("profileTemplateRow");
const profileTemplateSelectEl = document.getElementById("profileTemplateSelect");

const profileDeleteModalEl = document.getElementById("profileDeleteModal");
const profileDeleteTextEl = document.getElementById("profileDeleteText");
const profileDeleteConfirmEl = document.getElementById("profileDeleteConfirm");
const profileDeleteCancelEl = document.getElementById("profileDeleteCancel");

let profileNameMode = "new"; // "new" | "rename"

// Toolbar popovers (profile actions, sync). Trigger button toggles its menu;
// outside click, Escape, or clicking a button inside closes it.
const POPOVERS = [
  ["profileMenuBtn", "profileMenu"],
  ["syncMenuBtn", "syncMenu"],
  ["bankMenuBtn", "bankMenu"],
];
function closeAllPopovers(exceptMenu) {
  for (const [btnId, menuId] of POPOVERS) {
    const menu = document.getElementById(menuId);
    if (!menu || menu === exceptMenu) continue;
    menu.hidden = true;
    const btn = document.getElementById(btnId);
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
}
for (const [btnId, menuId] of POPOVERS) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  if (!btn || !menu) continue;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    closeAllPopovers(willOpen ? menu : null);
    menu.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  });
  // Profile actions open modals, so close the menu on click. The sync menu
  // stays open so its async status text remains visible after "Sync stats".
  if (menuId === "profileMenu") {
    menu.addEventListener("click", (e) => {
      if (e.target.closest("button")) closeAllPopovers();
    });
  }
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".popover-wrap")) closeAllPopovers();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllPopovers();
});

profileSelectEl.addEventListener("change", () => switchProfile(profileSelectEl.value));

// Fill the new-profile modal's template picker from the current template list.
function refreshTemplateSelect() {
  if (!profileTemplateSelectEl) return;
  profileTemplateSelectEl.innerHTML = "";
  Templates.listTemplates().forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.name} (${(t.goalData || []).length} goals)`;
    if (t.id === Templates.DEFAULT_TEMPLATE_ID) opt.selected = true;
    profileTemplateSelectEl.appendChild(opt);
  });
}

profileNewBtnEl.addEventListener("click", () => {
  profileNameMode = "new";
  profileNameModalTitleEl.textContent = "New profile";
  profileNameSubmitEl.textContent = "Create";
  profileNameInputEl.value = "";
  refreshTemplateSelect();
  profileTemplateRowEl.hidden = false;
  profileNameModalEl.hidden = false;
  profileNameInputEl.focus();
});

profileRenameBtnEl.addEventListener("click", () => {
  profileNameMode = "rename";
  profileNameModalTitleEl.textContent = "Rename profile";
  profileNameSubmitEl.textContent = "Save";
  profileNameInputEl.value = profilesMeta.profiles[profilesMeta.activeId].name;
  profileTemplateRowEl.hidden = true;
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
  if (profileNameMode === "new") createProfile(name, profileTemplateSelectEl.value);
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
  if (!templatesModalEl.hidden) closeTemplatesModal();
  if (templateChangesModalEl && !templateChangesModalEl.hidden) closeTemplateChangesModal();
});

// --- Profile export / import -----------------------------------------------------
// Export downloads the active profile as a JSON file; import loads such a file
// into a brand-new profile (running save-data migrations), so profiles can be
// moved between browsers or kept as backups.

// Download a profile (its state + pinned template base) as an importable JSON
// backup. Shared by the Export button and the template-update warning, so the
// user can snapshot their progress before an update they might want to roll back.
function exportProfile(profileId) {
  const p = profilesMeta.profiles[profileId];
  if (!p) return;
  const name = p.name;
  const payload = {
    app: "iron-tracker",
    version: 1,
    name,
    templateId: templateIdFor(profileId),
    // The pinned base snapshot: without it, importing a profile whose base was
    // customized/merged (a superset of the live template) would re-trim it to the
    // live template and drop those extra goals. null for internal (__full__)
    // profiles, which render the live tree and store no base.
    templateBase: loadTemplateBase(profileId),
    exportedAt: new Date().toISOString(),
    state: profileId === profilesMeta.activeId
      ? state
      : JSON.parse(localStorage.getItem(storageKeyFor(profileId)) || "null")
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "iron-tracker-" + (name.replace(/[^\w-]+/g, "_") || "profile") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

profileExportBtnEl.addEventListener("click", () => exportProfile(profilesMeta.activeId));

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
    const t = Templates.getTemplate(payload.templateId) || Templates.getTemplate(Templates.DEFAULT_TEMPLATE_ID);
    const tpl = t.id;
    profilesMeta.profiles[id] = { name, templateId: tpl, templateVersion: t.version || 1 };
    // Restore the exported base snapshot when present (preserves a customized/
    // merged base); otherwise fall back to the live template content (files that
    // predate base export). Internal templates (__full__) render the live tree.
    if (!t.internal) {
      const exportedBase = payload.templateBase && Array.isArray(payload.templateBase.goalData)
        ? payload.templateBase : t;
      saveTemplateBase(id, exportedBase);
    }
    profilesMeta.activeId = id;
    localStorage.setItem(storageKeyFor(id), JSON.stringify(migrated));
    saveProfilesMeta();
    applyProfileTemplate(id);
    state = loadState();
    clearUndo();
    refreshProfileSelect();
    render();
    showToast(`Imported profile "${name}"`);
  } catch (e) {
    showToast("Import failed: " + e.message);
  }
});
