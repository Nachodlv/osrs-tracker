
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

// --- Bank memory sync -----------------------------------------------------------
// A RuneLite "bank memory" export (Item id / Item name / Item quantity rows) auto-
// completes "item" goals by name. Matching is name-only: the source item id is not a
// real OSRS id on our goals, so the name is the bridge. A "(number)" charge suffix is
// dropped so "Amulet of glory(6)" matches goal "Amulet of glory", but a "(letters)"
// suffix is kept so variants like "Salve amulet(ei)" stay distinct. A leading "Open "
// (the opened variant of a storage item) is dropped so "Open gem bag" matches "Gem bag".
function normalizeItemName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^open /, "");
}

// Parse a bank export into { normalizedName: quantity }. Accepts tab- or comma-
// separated rows; skips a header row and any row without a usable name. Quantity
// defaults to 1 when absent/unparseable (presence is what matters for completion).
function parseBankMemory(text) {
  const bank = {};
  String(text || "").split(/\r?\n/).forEach(line => {
    const raw = line.trim();
    if (!raw) return;
    const cols = (raw.indexOf("\t") >= 0 ? raw.split("\t") : raw.split(",")).map(c => c.trim());
    if (cols.length < 2) return;
    // Rows are "id, name, qty". If the first cell is not numeric it is a header
    // ("Item id") or a name-first export; detect which by whether a numeric id leads.
    const idLeads = /^\d+$/.test(cols[0]);
    const name = idLeads ? cols[1] : cols[0];
    const qtyRaw = idLeads ? cols[2] : cols[1];
    if (!name || /^item\s*(id|name)$/i.test(name)) return;
    const key = normalizeItemName(name);
    if (!key) return;
    const qty = parseInt(String(qtyRaw).replace(/[^\d-]/g, ""), 10);
    bank[key] = (bank[key] || 0) + (Number.isFinite(qty) ? qty : 1);
  });
  return bank;
}

// Mark every not-done "item" goal whose name is in the bank (quantity >= 1) as done.
// Only ever completes goals (never unchecks), mirroring applySkillSync. Returns the
// number newly completed.
function applyBankSync() {
  let changed = 0;
  Object.values(currentNodes).forEach(node => {
    if (state.done[node.id] || node.type !== "item") return;
    if ((state.bank[normalizeItemName(node.title)] || 0) >= 1) {
      state.done[node.id] = true;
      changed++;
    }
  });
  return changed;
}

// --- RuneProfile sync -----------------------------------------------------------
// RuneProfile (RuneLite plugin + public API at api.runeprofile.com) exposes a
// player's skills and per-quest completion by username, CORS-open so the browser
// can call it directly (no proxy, unlike hiscores). Skills are an alternative
// source for the stat sync; quests are the only source we have for per-quest
// completion (the official hiscores expose only total quest points).
const RUNEPROFILE_BASE = "https://api.runeprofile.com/v1";

async function fetchRuneProfileJson(username, path) {
  const url = `${RUNEPROFILE_BASE}/accounts/${encodeURIComponent(username)}/${path}`;
  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error("Account not found on RuneProfile (install the plugin and sync once)");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* fall through */ }
  if (!res.ok || !data || !Array.isArray(data.data)) {
    throw new Error((data && data.error) || `Lookup failed (HTTP ${res.status})`);
  }
  return data.data;
}

// Returns a { skillName: level } map shaped like fetchHiscores, so applySkillSync
// consumes either source unchanged.
async function fetchRuneProfileSkills(username) {
  const rows = await fetchRuneProfileJson(username, "skills");
  const levels = {};
  rows.forEach(s => { if (s && s.name && s.level != null) levels[s.name] = s.level; });
  return levels;
}

// Normalize a quest name to a name-only key (punctuation, e.g. apostrophes and the
// "Between a Rock..." ellipsis, differs harmlessly between our titles and RuneProfile).
function normalizeQuestName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Returns a Set of normalized names of quests RuneProfile reports as finished.
async function fetchRuneProfileQuests(username) {
  const rows = await fetchRuneProfileJson(username, "quests");
  const finished = new Set();
  rows.forEach(q => { if (q && q.state === "finished") finished.add(normalizeQuestName(q.name)); });
  return finished;
}

// Mark every not-done "quest" goal whose name is in the finished set as done. Only
// ever completes goals (never unchecks), mirroring applySkillSync. Returns the count.
function applyQuestSync(finished) {
  let changed = 0;
  Object.values(currentNodes).forEach(node => {
    if (state.done[node.id] || node.type !== "quest") return;
    if (finished.has(normalizeQuestName(node.title))) {
      state.done[node.id] = true;
      changed++;
    }
  });
  return changed;
}

// Returns a Set of "<area>|<tier>" keys for every achievement diary the account
// has fully completed. RuneProfile reports per-tier task counts, so a tier counts
// as done only when every task in it is ticked.
async function fetchRuneProfileDiaries(username) {
  const rows = await fetchRuneProfileJson(username, "achievement-diaries");
  const done = new Set();
  rows.forEach(area => {
    if (!area || !Array.isArray(area.tiers)) return;
    area.tiers.forEach(t => {
      if (t && t.total > 0 && t.completed >= t.total) done.add(diaryKey(area.area, t.tier));
    });
  });
  return done;
}

function diaryKey(area, tier) {
  return normalizeDiaryText(area) + "|" + normalizeDiaryText(tier);
}

// Mark every not-done "diary" goal whose area+tier is fully completed. A diary goal
// with no resolvable tier (just an area) is left alone, since we cannot tell which
// of the four tiers it means. Only ever completes goals, like the other syncs.
function applyDiarySync(doneDiaries) {
  let changed = 0;
  Object.values(currentNodes).forEach(node => {
    if (state.done[node.id] || node.type !== "diary") return;
    const diary = parseDiaryGoal(node);
    if (!diary || !diary.tier) return;
    if (doneDiaries.has(diaryKey(diary.area, diary.tier))) {
      state.done[node.id] = true;
      changed++;
    }
  });
  return changed;
}

const rsnInputEl = document.getElementById("rsnInput");
const syncStatsBtnEl = document.getElementById("syncStatsBtn");
const syncStatusTextEl = document.getElementById("syncStatusText");

// Reflect the saved skill source into the radio group on load.
const savedSourceEl = document.querySelector(`input[name="skillSource"][value="${state.skillSource}"]`);
if (savedSourceEl) savedSourceEl.checked = true;

// The username is shared by the stats and quest popovers; keep both inputs in sync.
function setUsername(value) {
  state.username = value.trim();
  if (rsnInputEl) rsnInputEl.value = state.username;
  const q = document.getElementById("questRsnInput");
  if (q) q.value = state.username;
  saveState();
}

rsnInputEl.value = state.username || "";
rsnInputEl.addEventListener("change", () => setUsername(rsnInputEl.value));

syncStatsBtnEl.addEventListener("click", async () => {
  const username = rsnInputEl.value.trim();
  if (!username) {
    syncStatusTextEl.textContent = "Enter a username first";
    syncStatusTextEl.className = "sync-status error";
    return;
  }
  const source = (document.querySelector('input[name="skillSource"]:checked') || {}).value || "hiscores";
  state.skillSource = source;
  setUsername(username);
  syncStatusTextEl.textContent = "Looking up…";
  syncStatusTextEl.className = "sync-status";
  syncStatsBtnEl.disabled = true;
  try {
    const levels = source === "runeprofile"
      ? await fetchRuneProfileSkills(username)
      : await fetchHiscores(username);
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

const questRsnInputEl = document.getElementById("questRsnInput");
const questSyncBtnEl = document.getElementById("questSyncBtn");
const questStatusTextEl = document.getElementById("questStatusText");

questRsnInputEl.value = state.username || "";
questRsnInputEl.addEventListener("change", () => setUsername(questRsnInputEl.value));

questSyncBtnEl.addEventListener("click", async () => {
  const username = questRsnInputEl.value.trim();
  if (!username) {
    questStatusTextEl.textContent = "Enter a username first";
    questStatusTextEl.className = "sync-status error";
    return;
  }
  setUsername(username);
  questStatusTextEl.textContent = "Looking up…";
  questStatusTextEl.className = "sync-status";
  questSyncBtnEl.disabled = true;
  try {
    // Quests and diaries come from the same account, so one click syncs both.
    const [finished, doneDiaries] = await Promise.all([
      fetchRuneProfileQuests(username),
      fetchRuneProfileDiaries(username)
    ]);
    let quests = 0;
    let diaries = 0;
    withUndo("Synced quests and diaries from RuneProfile", () => {
      quests = applyQuestSync(finished);
      diaries = applyDiarySync(doneDiaries);
      saveState();
      render();
    });
    const parts = [];
    if (quests) parts.push(`${quests} quest${quests === 1 ? "" : "s"}`);
    if (diaries) parts.push(`${diaries} diar${diaries === 1 ? "y" : "ies"}`);
    questStatusTextEl.textContent = parts.length
      ? `Synced — ${parts.join(" and ")} completed`
      : "Synced — no new goals completed";
    questStatusTextEl.className = "sync-status success";
  } catch (e) {
    questStatusTextEl.textContent = e.message || "Sync failed";
    questStatusTextEl.className = "sync-status error";
  } finally {
    questSyncBtnEl.disabled = false;
  }
});

const bankFileInputEl = document.getElementById("bankFileInput");
const bankPasteInputEl = document.getElementById("bankPasteInput");
const bankApplyBtnEl = document.getElementById("bankApplyBtn");
const bankStatusTextEl = document.getElementById("bankStatusText");

// Read the pasted text, else the chosen file. Returns "" when neither is set.
function readBankSource() {
  const pasted = bankPasteInputEl.value.trim();
  if (pasted) return Promise.resolve(pasted);
  const file = bankFileInputEl.files && bankFileInputEl.files[0];
  if (!file) return Promise.resolve("");
  return file.text();
}

bankApplyBtnEl.addEventListener("click", async () => {
  let text;
  try { text = await readBankSource(); } catch (e) { text = ""; }
  if (!text.trim()) {
    bankStatusTextEl.textContent = "Choose a file or paste bank rows first";
    bankStatusTextEl.className = "sync-status error";
    return;
  }
  const parsed = parseBankMemory(text);
  const count = Object.keys(parsed).length;
  if (!count) {
    bankStatusTextEl.textContent = "No item rows found in that input";
    bankStatusTextEl.className = "sync-status error";
    return;
  }
  const mode = (document.querySelector('input[name="bankMode"]:checked') || {}).value || "replace";
  let changed = 0;
  withUndo("Applied bank memory", () => {
    if (mode === "add") {
      Object.keys(parsed).forEach(k => { state.bank[k] = (state.bank[k] || 0) + parsed[k]; });
    } else {
      state.bank = parsed;
    }
    changed = applyBankSync();
    saveState();
    render();
  });
  bankFileInputEl.value = "";
  bankPasteInputEl.value = "";
  bankStatusTextEl.textContent = `Loaded ${count} item${count === 1 ? "" : "s"} — ` +
    (changed ? `${changed} goal${changed === 1 ? "" : "s"} completed` : "no new goals completed");
  bankStatusTextEl.className = "sync-status success";
});
