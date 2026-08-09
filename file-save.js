
// --- Save profile to a file on the PC ------------------------------------------
// localStorage stays the primary store: every edit is saved there as before. On
// top of that a profile can be linked to a real file on disk (File System Access
// API). New profiles are linked right away (the picker opens on creation); for
// older ones the first save asks where to put the file. Later saves overwrite
// that same file without a prompt. Between saves the profile is flagged
// "unsaved" (the flag itself is persisted, so closing the tab and coming back
// keeps the warning alive): the tab title gets a "(*)" marker, a Save button
// appears in the profile bar, and leaving the page triggers the browser's confirm.
// The file handle lives in IndexedDB because handles cannot be serialized to
// localStorage.

const FILE_DIRTY_KEY = "iron-tracker:file-dirty";
const FILE_HANDLE_DB = "iron-tracker-files";
const FILE_HANDLE_STORE = "handles";

const pcSaveBtnEl = document.getElementById("pcSaveBtn");
const pcSaveAsBtnEl = document.getElementById("pcSaveAsBtn");
const pcSaveNowBtnEl = document.getElementById("pcSaveNowBtn");

const BASE_PAGE_TITLE = document.title;

const supportsFilePicker = typeof window.showSaveFilePicker === "function";

// Handle for the active profile's linked file, or null when it has none.
let pcFileHandle = null;
let pcFileHandleProfileId = null;

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FILE_HANDLE_STORE)) {
        req.result.createObjectStore(FILE_HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function handleTx(mode, fn) {
  return openHandleDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_HANDLE_STORE, mode);
    const req = fn(tx.objectStore(FILE_HANDLE_STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

function loadFileHandle(profileId) {
  return handleTx("readonly", store => store.get(profileId)).catch(() => null);
}
function storeFileHandle(profileId, handle) {
  return handleTx("readwrite", store => store.put(handle, profileId)).catch(() => {});
}
function removeFileHandle(profileId) {
  return handleTx("readwrite", store => store.delete(profileId)).catch(() => {});
}

// --- Unsaved-changes flag (per profile, persisted) ----------------------------

function loadDirtyMap() {
  try {
    const raw = localStorage.getItem(FILE_DIRTY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) {
    console.error("Failed to load unsaved-file flags", e);
  }
  return {};
}

function isFileDirty(profileId) {
  return loadDirtyMap()[profileId] === true;
}

function setFileDirty(profileId, dirty) {
  const map = loadDirtyMap();
  if (dirty) map[profileId] = true;
  else delete map[profileId];
  localStorage.setItem(FILE_DIRTY_KEY, JSON.stringify(map));
}

// Any profile still holding unsaved changes for its linked file.
function hasUnsavedFileChanges() {
  return Object.keys(loadDirtyMap()).length > 0;
}

// --- UI ----------------------------------------------------------------------

function refreshPcSaveUi() {
  const linked = !!pcFileHandle;
  const dirty = linked && isFileDirty(profilesMeta.activeId);
  if (pcSaveBtnEl) {
    pcSaveBtnEl.textContent = linked
      ? (dirty ? "Save to PC *" : "Save to PC")
      : "Save to PC...";
    pcSaveBtnEl.title = linked
      ? "Write this profile to " + (pcFileHandle.name || "its file") + " on your PC"
      : "Pick a file on your PC to keep this profile saved in";
  }
  if (pcSaveAsBtnEl) pcSaveAsBtnEl.hidden = !linked || !supportsFilePicker;
  if (pcSaveNowBtnEl) {
    pcSaveNowBtnEl.hidden = !dirty;
    pcSaveNowBtnEl.title = dirty
      ? "Unsaved on PC: write this profile to " + (pcFileHandle.name || "its file")
      : "";
  }
  // The tab title carries the same unsaved marker, so a background tab shows it.
  document.title = dirty ? "(*) " + BASE_PAGE_TITLE : BASE_PAGE_TITLE;
}

// --- Writing -----------------------------------------------------------------

async function ensureWritePermission(handle) {
  if (!handle.queryPermission) return true;
  const opts = { mode: "readwrite" };
  if (await handle.queryPermission(opts) === "granted") return true;
  return await handle.requestPermission(opts) === "granted";
}

async function writeProfileToHandle(profileId, handle) {
  const payload = buildProfilePayload(profileId);
  if (!payload) return false;
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(payload, null, 2));
  } finally {
    await writable.close();
  }
  return true;
}

// Ask the user where to keep this profile's file and remember the choice.
async function pickProfileFile(profileId) {
  const handle = await window.showSaveFilePicker({
    suggestedName: profileFileName(profileId),
    types: [{ description: "Iron Tracker profile", accept: { "application/json": [".json"] } }]
  });
  await storeFileHandle(profileId, handle);
  if (profileId === profilesMeta.activeId) {
    pcFileHandle = handle;
    pcFileHandleProfileId = profileId;
  }
  return handle;
}

// Save the active profile to its file on disk, prompting for a location the
// first time (or whenever `forcePick` is set). Browsers without the File System
// Access API fall back to a plain download.
async function saveProfileToPc(forcePick) {
  const profileId = profilesMeta.activeId;
  if (!supportsFilePicker) {
    exportProfile(profileId);
    setFileDirty(profileId, false);
    refreshPcSaveUi();
    showToast("This browser cannot overwrite files, downloaded a copy instead");
    return;
  }
  try {
    let handle = forcePick ? null : pcFileHandle;
    if (!handle) handle = await pickProfileFile(profileId);
    if (!await ensureWritePermission(handle)) {
      showToast("Permission to write the file was denied");
      return;
    }
    await writeProfileToHandle(profileId, handle);
    setFileDirty(profileId, false);
    refreshPcSaveUi();
    showToast("Saved to " + handle.name);
  } catch (e) {
    if (e && e.name === "AbortError") return; // user closed the picker
    console.error("Save to PC failed", e);
    showToast("Save to PC failed: " + e.message);
  }
}

// Saving to a file is the default for new profiles: ask for a location right
// after creation. Browsers without the picker keep the manual Export flow (a
// forced download on every new profile would be worse than nothing).
function promptSaveNewProfileToPc() {
  if (!supportsFilePicker) return;
  saveProfileToPc(true);
}

// --- Hooks from state.js -----------------------------------------------------

// Called after every localStorage save: the linked file is now behind.
function onStateSaved() {
  if (!pcFileHandle) return;
  if (!isFileDirty(profilesMeta.activeId)) {
    setFileDirty(profilesMeta.activeId, true);
    refreshPcSaveUi();
  }
}

function onProfileDeleted(profileId) {
  removeFileHandle(profileId);
  setFileDirty(profileId, false);
}

// Re-bind to the active profile's file (handles are per profile).
function onActiveProfileChanged() {
  const profileId = profilesMeta.activeId;
  if (profileId === pcFileHandleProfileId) { refreshPcSaveUi(); return; }
  pcFileHandle = null;
  pcFileHandleProfileId = profileId;
  refreshPcSaveUi();
  loadFileHandle(profileId).then(handle => {
    // A file picked in the meantime (new profile) wins over this stale read.
    if (profilesMeta.activeId !== profileId || pcFileHandle) return;
    pcFileHandle = handle || null;
    refreshPcSaveUi();
  });
}

// --- Wiring ------------------------------------------------------------------

if (pcSaveBtnEl) pcSaveBtnEl.addEventListener("click", () => saveProfileToPc(false));
if (pcSaveAsBtnEl) pcSaveAsBtnEl.addEventListener("click", () => saveProfileToPc(true));
if (pcSaveNowBtnEl) pcSaveNowBtnEl.addEventListener("click", () => saveProfileToPc(false));

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveProfileToPc(false);
  }
});

// Progress is already safe in localStorage, but the file on disk is stale, so
// warn before the page goes away. Any profile with a pending write counts.
window.addEventListener("beforeunload", e => {
  if (!hasUnsavedFileChanges()) return;
  e.preventDefault();
  e.returnValue = "";
  return "";
});

onActiveProfileChanged();
