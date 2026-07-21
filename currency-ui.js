
// --- Currency ledger UI -------------------------------------------------------
// Two surfaces over state.currencies / state.costs (totals live in graph.js):
//  - the "Costs" rows in the add/edit goal modal, editing a draft that is only
//    written to state on submit, so cancelling mints nothing.
//  - the "Currencies" toolbar popover: per resource, how much every goal needs
//    added up, versus how much you hold.

const costsSectionEl = document.getElementById("goalCostsSection");
const costRowsEl = document.getElementById("goalCostRows");
const costNameInput = document.getElementById("goalCostName");
const costAmountInput = document.getElementById("goalCostAmount");
const costAddBtn = document.getElementById("goalCostAdd");
const currencyNameListEl = document.getElementById("currencyNameList");
const currencyMenuEl = document.getElementById("currencyMenu");
const currencyListEl = document.getElementById("currencyList");

// { currencyId: { name, amount } } for the goal being added/edited. Keyed by the
// slug so an existing currency is reused, but the registry is untouched until
// writeGoalCosts runs.
let goalCostDraft = {};

function resetGoalCosts() {
  goalCostDraft = {};
  costNameInput.value = "";
  costAmountInput.value = "";
  renderGoalCostRows();
}

function fillGoalCosts(id) {
  goalCostDraft = {};
  const saved = (state.costs && state.costs[id]) || {};
  Object.keys(saved).forEach(cid => {
    const cur = state.currencies[cid];
    goalCostDraft[cid] = { name: (cur && cur.name) || cid, amount: Number(saved[cid]) || 0 };
  });
  renderGoalCostRows();
}

function currentGoalCosts() {
  const out = {};
  Object.keys(goalCostDraft).forEach(cid => {
    out[cid] = { name: goalCostDraft[cid].name, amount: goalCostDraft[cid].amount };
  });
  return out;
}

// Only an item is something you buy, so only an item goal carries costs. Other
// types hide the section entirely; a goal switched away from "item" drops the
// costs it used to have (see writeGoalCosts) rather than keeping them invisible.
function goalTypeHasCosts(type) {
  return type === "item";
}

function syncGoalCostsVisibility(type) {
  costsSectionEl.hidden = !goalTypeHasCosts(type);
}

// Persists a draft onto a goal, registering any currency it names. Amounts of 0
// or less drop the entry, and a goal with no costs left keeps no key at all.
function writeGoalCosts(id, costs, type) {
  if (!goalTypeHasCosts(type)) { delete state.costs[id]; return; }
  if (!costs) return;
  const clean = {};
  Object.keys(costs).forEach(cid => {
    const amount = Number(costs[cid] && costs[cid].amount) || 0;
    if (amount <= 0) return;
    const realId = ensureCurrency(costs[cid].name || cid);
    if (realId) clean[realId] = amount;
  });
  if (Object.keys(clean).length) state.costs[id] = clean;
  else delete state.costs[id];
}

function renderGoalCostRows() {
  costRowsEl.innerHTML = "";
  const ids = Object.keys(goalCostDraft);
  if (!ids.length) {
    const hint = document.createElement("div");
    hint.className = "goal-cost-empty";
    hint.textContent = "No costs yet.";
    costRowsEl.appendChild(hint);
  }
  ids.forEach(cid => {
    const entry = goalCostDraft[cid];
    const row = document.createElement("div");
    row.className = "goal-cost-row";

    const label = document.createElement("span");
    label.className = "goal-cost-name";
    label.textContent = entry.name;
    row.appendChild(label);

    const amount = document.createElement("input");
    amount.type = "text";
    amount.inputMode = "decimal";
    amount.className = "goal-cost-amount";
    amount.title = "Accepts k, m and b suffixes";
    // Inputs always show the exact number: formatCurrencyAmount rounds (12345 ->
    // "12.3K"), so echoing it back would corrupt the amount on the next save.
    amount.value = String(entry.amount);
    amount.addEventListener("change", () => {
      const v = parseAmount(amount.value);
      if (v !== null && v > 0) {
        entry.amount = v;
        amount.value = String(v); // "1.5m" resolves visibly to 1500000
      } else {
        delete goalCostDraft[cid];
        renderGoalCostRows();
      }
    });
    row.appendChild(amount);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "goal-link-remove";
    remove.textContent = "×";
    remove.title = "Remove cost";
    remove.addEventListener("click", () => { delete goalCostDraft[cid]; renderGoalCostRows(); });
    row.appendChild(remove);

    costRowsEl.appendChild(row);
  });
  refreshCurrencyDatalist();
}

function addDraftCost() {
  const name = costNameInput.value.trim();
  const amount = parseAmount(costAmountInput.value);
  if (!name || amount === null || amount <= 0) return;
  const cid = currencySlug(name);
  if (!cid) return;
  // Re-adding a currency already on this goal replaces its amount rather than
  // silently doing nothing.
  const existing = state.currencies[cid];
  goalCostDraft[cid] = { name: (existing && existing.name) || name, amount };
  costNameInput.value = "";
  costAmountInput.value = "";
  renderGoalCostRows();
  costNameInput.focus();
}

costAddBtn.addEventListener("click", addDraftCost);
// The costs inputs sit inside the goal <form>, so Enter would submit the whole
// modal; make it add the cost instead.
[costNameInput, costAmountInput].forEach(el => {
  el.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addDraftCost();
  });
});

function refreshCurrencyDatalist() {
  currencyNameListEl.innerHTML = "";
  Object.values(state.currencies || {}).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    currencyNameListEl.appendChild(opt);
  });
}

// --- Ledger popover -----------------------------------------------------------

function refreshCurrencyPanel() {
  if (!currencyMenuEl || currencyMenuEl.hidden) return;
  renderCurrencyPanel();
}

function renderCurrencyPanel() {
  const totals = currencyTotals(currentNodes);
  const rows = Object.values(totals).sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  currencyListEl.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "popover-note";
    empty.textContent = "No goal has a cost yet. Right-click a goal, pick Edit, and add one under \"Costs\".";
    currencyListEl.appendChild(empty);
    return;
  }

  rows.forEach(row => {
    const item = document.createElement("div");
    item.className = "currency-row";

    const head = document.createElement("div");
    head.className = "currency-head";

    const name = document.createElement("span");
    name.className = "currency-name";
    name.textContent = row.name;
    head.appendChild(name);

    const held = document.createElement("input");
    held.type = "text";
    held.inputMode = "decimal";
    held.className = "currency-held";
    held.value = String(row.held);
    held.title = "How many you hold (accepts k, m and b suffixes)";
    held.addEventListener("change", () => {
      const v = parseAmount(held.value);
      withUndo("Edited currency", () => {
        // A cost can name a currency the registry lost track of; re-register it
        // rather than throwing.
        const cur = state.currencies[row.id] ||
          (state.currencies[row.id] = { id: row.id, name: row.name, bankName: row.bankName, held: 0 });
        cur.held = v !== null && v > 0 ? v : 0;
        saveState();
        render(); // redraws this panel too, via refreshCurrencyPanel
      });
    });
    head.appendChild(held);

    const need = document.createElement("span");
    need.className = "currency-need" + (row.held >= row.remaining ? " met" : "");
    need.textContent = "/ " + formatCurrencyAmount(row.remaining) + " needed";
    need.title = `${row.remaining} still needed (${row.required} across all goals, done or not)`;
    head.appendChild(need);

    item.appendChild(head);

    const short = Math.max(0, row.remaining - row.held);
    const sub = document.createElement("div");
    sub.className = "currency-sub";
    sub.textContent = row.goals.length
      ? (short ? `${formatCurrencyAmount(short)} short · ` : "Covered · ") +
        `${row.goals.length} goal${row.goals.length === 1 ? "" : "s"} · ${formatCurrencyAmount(row.required)} total`
      : "No goals spend this yet";
    item.appendChild(sub);

    row.goals.forEach(g => {
      const line = document.createElement("div");
      line.className = "currency-goal" + (g.done ? " done" : "");
      line.textContent = `${formatCurrencyAmount(g.amount)} · ${g.title}`;
      item.appendChild(line);
    });

    currencyListEl.appendChild(item);
  });
}

// The popover is toggled by the shared handler in profiles-ui.js, so fill it on
// open (a hidden panel is not kept up to date).
const currencyMenuBtnEl = document.getElementById("currencyMenuBtn");
if (currencyMenuBtnEl) {
  currencyMenuBtnEl.addEventListener("click", () => {
    if (!currencyMenuEl.hidden) renderCurrencyPanel();
  });
}
