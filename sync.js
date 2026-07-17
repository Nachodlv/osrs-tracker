
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
