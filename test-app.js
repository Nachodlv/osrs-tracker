#!/usr/bin/env node
// Headless regression tests for app graph/state logic. Run with: node test-app.js
// Loads migration.js + data.js + app.js into a vm with a minimal DOM stub, then
// exercises the pure graph functions (getGraph, computeVisibility, addLinkedChild,
// reparentNode, ...). This covers data/layout bugs without a browser; CSS and
// real rendering still need the preview tools. State lives in a closure `let`, so
// assertions run INSIDE the context via inCtx().

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// --- Minimal DOM stub so app.js can load and render() can run without a browser.
function makeEl() {
  const el = {
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], hidden: false, value: "", textContent: "", innerHTML: "",
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore(c) { this.children.push(c); return c; },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    setAttributeNS() {}, hasChildNodes() { return this.children.length > 0; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    focus() {}, blur() {}, click() {}, cloneNode() { return makeEl(); },
  };
  return el;
}

function makeContext() {
  const elCache = {};
  const documentStub = {
    getElementById(id) { return (elCache[id] = elCache[id] || makeEl()); },
    createElement() { return makeEl(); }, createElementNS() { return makeEl(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl(), documentElement: makeEl(), activeElement: null,
    elementFromPoint() { return null; },
  };
  class LS {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
    key(i) { return [...this.m.keys()][i]; }
    get length() { return this.m.size; }
  }
  const windowStub = {
    addEventListener() {}, removeEventListener() {},
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    location: { reload() {}, href: "http://localhost/" }, open() {},
  };
  const ctx = {
    document: documentStub, window: windowStub, localStorage: new LS(),
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame(f) { return setTimeout(f, 0); },
    navigator: { userAgent: "node" },
    fetch() { return new Promise(() => {}); }, // deterministic tests avoid network
    URL, encodeURIComponent, decodeURIComponent, JSON, Math, Date, Object, Array,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ["migration.js", "data.js", "templates.js", "app.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
  }
  return ctx;
}

const ctx = makeContext();

// Runs `body` inside a fresh-state context and returns its (plain-data) result.
// Custom goals here use type "quest" so icon/link resolution is deterministic
// (no fetch); "other" would hit the network.
function inCtx(body) {
  const src = `(function(){
    state.customNodes = {}; state.linkedEdges = {}; state.removedEdges = {};
    state.rootGoals = {}; state.order = {}; state.collapsed = {};
    state.done = {}; state.overrides = {}; state.removed = {}; state.groupsState = null;
    const R = (function(){ ${body} })();
    return JSON.parse(JSON.stringify(R));
  })()`;
  return vm.runInContext(src, ctx);
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok - " + name);
  } catch (e) {
    console.error("  FAIL - " + name);
    console.error("    " + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}

console.log("Grouped goal linked as a child (renders in both places)");

test("a grouped goal keeps its group membership after being linked as a child", () => {
  const r = inCtx(`
    addCustomChild(null, "Q", { type: "quest" });
    const Q = Object.keys(state.customNodes)[0];
    const P = "gear.dragon-scimitar"; // member of a GEAR_GROUP
    ensureGroupsState();
    addLinkedChild(Q, P);
    return { group: getGroupOf(P), hasParent: getGraph().nodes[P].parentIds.includes(Q) };
  `);
  assert.strictEqual(r.group, "g3", "should stay in its tier group");
  assert.strictEqual(r.hasParent, true, "should also be a child of Q");
});

test("a grouped goal stays visible even when its new parent is collapsed", () => {
  // This is the bug: without treating group members as root-like, a grouped
  // goal linked under a collapsed parent becomes invisible (disappears).
  const r = inCtx(`
    addCustomChild(null, "Q", { type: "quest" });
    const Q = Object.keys(state.customNodes)[0];
    const P = "gear.dragon-scimitar";
    ensureGroupsState();
    addLinkedChild(Q, P);
    state.collapsed[Q] = true; // parent collapsed, so P is not reachable via Q
    const nodes = getGraph().nodes;
    const grouped = new Set();
    state.groupsState.groupOrder.forEach(gid =>
      (state.groupsState.groups[gid] || []).forEach(id => grouped.add(id)));
    return {
      withoutRootLike: computeVisibility(nodes)[P] === true,
      withRootLike: computeVisibility(nodes, grouped)[P] === true,
    };
  `);
  assert.strictEqual(r.withoutRootLike, false, "reachability-only would hide it (the bug)");
  assert.strictEqual(r.withRootLike, true, "as a group member it stays visible (the fix)");
});

console.log("\nGraph invariants");

test("computeVisibility hides a normal child whose only parent is collapsed", () => {
  const r = inCtx(`
    addCustomChild(null, "P", { type: "quest" });
    const P = Object.keys(state.customNodes)[0];
    addCustomChild(P, "C", { type: "quest" });
    const C = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "C");
    state.collapsed[P] = true;
    return { visible: computeVisibility(getGraph().nodes)[C] === true };
  `);
  assert.strictEqual(r.visible, false);
});

test("reparenting a custom parent onto another custom node keeps its subtree", () => {
  // Regression for the two-pass getEffectiveTree fix: a custom node parented by
  // another custom node must resolve regardless of iteration order.
  const r = inCtx(`
    addCustomChild(null, "R", { type: "quest" });
    const R = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "R");
    addCustomChild(R, "A", { type: "quest" });
    const A = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "A");
    addCustomChild(A, "B", { type: "quest" });
    const B = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "B");
    addCustomChild(null, "D", { type: "quest" });
    const D = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "D");
    currentNodes = getGraph().nodes;
    reparentNode(A, R, D);
    const nodes = getGraph().nodes;
    return { A: !!nodes[A], B: !!nodes[B], AunderD: nodes[A] && nodes[A].parentIds.includes(D) };
  `);
  assert.strictEqual(r.A, true, "reparented node survives");
  assert.strictEqual(r.B, true, "its child survives");
  assert.strictEqual(r.AunderD, true, "it is now under the new parent");
});

test("addLinkedChild rejects a cycle", () => {
  const r = inCtx(`
    addCustomChild(null, "P", { type: "quest" });
    const P = Object.keys(state.customNodes)[0];
    addCustomChild(P, "C", { type: "quest" });
    const C = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "C");
    currentNodes = getGraph().nodes;
    return { ok: addLinkedChild(C, P) }; // linking P under its own descendant
  `);
  assert.strictEqual(r.ok, false);
});

console.log("\nDefault save (new profiles)");

test("new saves show only grouped gear, no ungrouped goals or sub-goals", () => {
  const r = inCtx(`
    state = defaultState();
    const nodes = getGraph().nodes;
    return {
      grouped: !!nodes["gear.dragon-scimitar"],
      ungrouped: !!nodes["herb-run"],
      subgoal: !!nodes["spirit-tree.75construction"],
      groupedSub: !!nodes["piety.70def"]
    };
  `);
  assert.strictEqual(r.grouped, true, "grouped gear stays visible");
  assert.strictEqual(r.ungrouped, false, "ungrouped top-level goal is removed");
  assert.strictEqual(r.subgoal, false, "sub-goal of a grouped goal is removed");
  assert.strictEqual(r.groupedSub, false, "sub-goal is removed");
});

test("existing saves keep their goals (don't inherit the new default removed)", () => {
  const r = inCtx(`
    // Simulate a pre-existing profile whose stored save removed nothing.
    localStorage.setItem(storageKeyFor(profilesMeta.activeId), JSON.stringify({ done: {}, removed: {} }));
    state = loadState();
    const nodes = getGraph().nodes;
    return { ungrouped: !!nodes["herb-run"], subgoal: !!nodes["piety.70def"] };
  `);
  assert.strictEqual(r.ungrouped, true, "stored save keeps its ungrouped goal");
  assert.strictEqual(r.subgoal, true, "stored save keeps its sub-goals");
});

console.log("Templates");

test("empty template produces a graph with no built-in goals", () => {
  const r = inCtx(`
    Templates.applyTemplate("empty");
    const nodes = getGraph().nodes;
    const res = { count: Object.keys(nodes).length, ladlor: !!nodes["herb-run"] };
    Templates.applyTemplate("ladlor"); // restore for later tests
    return res;
  `);
  assert.strictEqual(r.count, 0, "empty template yields an empty graph");
  assert.strictEqual(r.ladlor, false, "no Ladlor nodes under empty template");
});

test("ladlor template restores the full built-in tree", () => {
  const r = inCtx(`
    Templates.applyTemplate("ladlor");
    return { ladlor: !!getGraph().nodes["herb-run"] };
  `);
  assert.strictEqual(r.ladlor, true, "Ladlor nodes present under ladlor template");
});

test("createProfile records the chosen template id", () => {
  const r = inCtx(`
    createProfile("Blank", "empty");
    const id = profilesMeta.activeId;
    const tpl = profilesMeta.profiles[id].templateId;
    const count = Object.keys(getGraph().nodes).length;
    Templates.applyTemplate("ladlor");
    return { tpl: tpl, count: count };
  `);
  assert.strictEqual(r.tpl, "empty", "new profile stores its templateId");
  assert.strictEqual(r.count, 0, "empty-template profile starts with no goals");
});

test("an imported user template becomes available and applicable", () => {
  const r = inCtx(`
    Templates.addUserTemplate({ name: "Mini", goalData: [{ id: "x-goal", title: "X", type: "quest" }], gearGroups: [] });
    const t = Templates.listTemplates().find(t => t.name === "Mini");
    Templates.applyTemplate(t.id);
    const has = !!getGraph().nodes["x-goal"];
    Templates.removeUserTemplate(t.id);
    const gone = !Templates.getTemplate(t.id);
    Templates.applyTemplate("ladlor");
    return { has: has, gone: gone };
  `);
  assert.strictEqual(r.has, true, "custom template's goal renders when applied");
  assert.strictEqual(r.gone, true, "removed user template is no longer listed");
});

console.log("\n" + passed + " test(s) passed.");
if (process.exitCode) console.error("Some app tests failed.");
else console.log("All app tests passed.");
