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

test("a custom sub-goal is promoted to top-level when its parent goal leaves the template", () => {
  // Regression: switching/trimming a template must never silently lose a custom
  // sub-goal whose parent goal is no longer in the template.
  const r = inCtx(`
    Templates.applyTemplate(Templates.FULL_TEMPLATE_ID);
    addCustomChild("piety", "Sub", { type: "quest" });
    const subId = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "Sub");
    addCustomChild(subId, "Nested", { type: "quest" });
    const nestedId = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "Nested");
    Templates.applyTemplate("ladlor"); // ladlor has gear.* only, no "piety" tree node
    const g = getGraph().nodes;
    return {
      subRendered: !!g[subId],
      subTopLevel: g[subId] ? g[subId].parentIds.length === 0 : null,
      nestedUnderSub: g[nestedId] ? g[nestedId].parentIds.includes(subId) : false,
      parentKept: state.customNodes[subId].parentId
    };
  `);
  assert.strictEqual(r.subRendered, true, "orphaned custom sub-goal still renders");
  assert.strictEqual(r.subTopLevel, true, "it is promoted to a top-level goal");
  assert.strictEqual(r.nestedUnderSub, true, "its own custom child stays nested under it");
  assert.strictEqual(r.parentKept, "piety", "its parentId is preserved so re-adding the parent re-nests it");
});

test("a custom sub-goal of a user-removed built-in parent still cascade-hides (not promoted)", () => {
  const r = inCtx(`
    Templates.applyTemplate(Templates.FULL_TEMPLATE_ID);
    addCustomChild("piety", "Child", { type: "quest" });
    const cid = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "Child");
    const before = !!getGraph().nodes[cid];
    state.removed["piety"] = true; // the parent is still in the template, just hidden
    const after = !!getGraph().nodes[cid];
    Templates.applyTemplate("ladlor");
    return { before, after };
  `);
  assert.strictEqual(r.before, true, "the custom child shows while its parent is present");
  assert.strictEqual(r.after, false, "hiding the built-in parent cascade-hides its custom child");
});

console.log("\nDefault save (new profiles)");

test("a new Ladlor profile shows only the web-page gear, nothing hidden", () => {
  const r = inCtx(`
    Templates.applyTemplate("ladlor");
    state = defaultState();
    const nodes = getGraph().nodes;
    return {
      grouped: !!nodes["gear.dragon-scimitar"],
      ungrouped: !!nodes["herb-run"],
      subgoal: !!nodes["spirit-tree.75construction"],
      groupedSub: !!nodes["piety.70def"],
      removed: Object.keys(state.removed).length
    };
  `);
  assert.strictEqual(r.grouped, true, "grouped gear is present");
  assert.strictEqual(r.ungrouped, false, "ungrouped goal is not in the ladlor template");
  assert.strictEqual(r.subgoal, false, "sub-goal of a grouped goal is not in the template");
  assert.strictEqual(r.groupedSub, false, "sub-goal is not in the template");
  assert.strictEqual(r.removed, 0, "nothing is hidden; extras are simply absent");
});

test("pre-existing profiles keep the full tree (pinned to __full__)", () => {
  const r = inCtx(`
    // A profile that predates templates renders against the complete tree.
    Templates.applyTemplate(Templates.FULL_TEMPLATE_ID);
    localStorage.setItem(storageKeyFor(profilesMeta.activeId), JSON.stringify({ done: {}, removed: {} }));
    state = loadState();
    const nodes = getGraph().nodes;
    const res = { ungrouped: !!nodes["herb-run"], subgoal: !!nodes["piety.70def"] };
    Templates.applyTemplate("ladlor");
    return res;
  `);
  assert.strictEqual(r.ungrouped, true, "legacy profile still shows its ungrouped goals");
  assert.strictEqual(r.subgoal, true, "legacy profile still shows its sub-goals");
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

test("ladlor template contains only web-page gear (no herb runs / sub-goals)", () => {
  const r = inCtx(`
    Templates.applyTemplate("ladlor");
    const nodes = getGraph().nodes;
    return { gear: !!nodes["gear.dragon-scimitar"], herb: !!nodes["herb-run"] };
  `);
  assert.strictEqual(r.gear, true, "grouped gear present under ladlor template");
  assert.strictEqual(r.herb, false, "off-page goals excluded from the ladlor template");
});

test("importing a template ignores its id and never overwrites a built-in", () => {
  const r = inCtx(`
    const rec = Templates.addUserTemplate({ id: "ladlor", name: "Sneaky", goalData: [], gearGroups: [] });
    const ladlor = Templates.getTemplate("ladlor");
    const res = { newId: rec.id !== "ladlor", ladlorIntact: !!(ladlor && ladlor.builtin) };
    Templates.removeUserTemplate(rec.id);
    return res;
  `);
  assert.strictEqual(r.newId, true, "a fresh internal id is minted on import");
  assert.strictEqual(r.ladlorIntact, true, "the built-in ladlor template is untouched");
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

test("templateFromCurrentProfile captures the current chart (custom goal included)", () => {
  const r = inCtx(`
    Templates.applyTemplate("empty");
    state.removed = {}; state.customNodes = {};
    addCustomChild(null, "Root goal", { type: "quest" });
    const rootId = Object.keys(state.customNodes)[0];
    addCustomChild(rootId, "Child goal", { type: "quest" });
    render();
    const tpl = templateFromCurrentProfile("Snapshot");
    Templates.applyTemplate("ladlor");
    return {
      name: tpl.name,
      roots: tpl.goalData.length,
      rootTitle: tpl.goalData[0] && tpl.goalData[0].title,
      childTitle: tpl.goalData[0] && tpl.goalData[0].children[0] && tpl.goalData[0].children[0].title
    };
  `);
  assert.strictEqual(r.name, "Snapshot");
  assert.strictEqual(r.roots, 1, "one top-level goal captured");
  assert.strictEqual(r.rootTitle, "Root goal");
  assert.strictEqual(r.childTitle, "Child goal", "nested child captured");
});

test("a profile made from a user template keeps its ungrouped goals and sub-goals", () => {
  const r = inCtx(`
    createProfile("Builder", "empty");
    addCustomChild(null, "My Root", { type: "quest" });
    const rid = Object.keys(state.customNodes)[0];
    addCustomChild(rid, "My Sub", { type: "quest" });
    render();
    const rec = Templates.addUserTemplate(templateFromCurrentProfile("MyTpl"));
    createProfile("User", rec.id);
    const g = getGraph().nodes;
    const rootId = Object.keys(g).find(id => g[id].title === "My Root");
    const res = {
      rootShown: !!rootId,
      childShown: rootId ? g[g[rootId].childIds[0]].title : null,
      removedCount: Object.keys(state.removed).length
    };
    Templates.removeUserTemplate(rec.id);
    Templates.applyTemplate("ladlor");
    return res;
  `);
  assert.strictEqual(r.rootShown, true, "ungrouped goal shows under a user template");
  assert.strictEqual(r.childShown, "My Sub", "sub-goal shows under a user template");
  assert.strictEqual(r.removedCount, 0, "user templates hide nothing by default");
});

test("a fresh Ladlor profile excludes off-page goals without hiding anything", () => {
  const r = inCtx(`
    createProfile("L", "ladlor");
    const g = getGraph().nodes;
    return { herb: !!g["herb-run"], gear: !!g["gear.dragon-scimitar"], removed: Object.keys(state.removed).length };
  `);
  assert.strictEqual(r.herb, false, "herb-run is not part of the ladlor template");
  assert.strictEqual(r.gear, true, "web-page gear is present");
  assert.strictEqual(r.removed, 0, "nothing is removed; extras are simply absent");
});

test("ensureProfileTemplates pins existing profiles to __full__ and new ones to ladlor", () => {
  const r = inCtx(`
    const withSave = "p-withsave";
    profilesMeta.profiles[withSave] = { name: "Old" };
    localStorage.setItem(storageKeyFor(withSave), JSON.stringify({ done: {}, removed: {} }));
    const noSave = "p-nosave";
    profilesMeta.profiles[noSave] = { name: "Brand new" };
    ensureProfileTemplates();
    const res = {
      withSave: profilesMeta.profiles[withSave].templateId,
      noSave: profilesMeta.profiles[noSave].templateId
    };
    delete profilesMeta.profiles[withSave];
    delete profilesMeta.profiles[noSave];
    localStorage.removeItem(storageKeyFor("p-withsave"));
    return res;
  `);
  assert.strictEqual(r.withSave, "__full__", "a profile with saved data keeps the full tree");
  assert.strictEqual(r.noSave, "ladlor", "a brand-new profile starts from the ladlor template");
});

test("ensureProfileTemplates leaves an explicit templateId untouched", () => {
  const r = inCtx(`
    const id = "p-explicit";
    profilesMeta.profiles[id] = { name: "Chosen", templateId: "empty" };
    localStorage.setItem(storageKeyFor(id), JSON.stringify({ done: {} }));
    ensureProfileTemplates();
    const res = profilesMeta.profiles[id].templateId;
    delete profilesMeta.profiles[id];
    localStorage.removeItem(storageKeyFor(id));
    return { tpl: res };
  `);
  assert.strictEqual(r.tpl, "empty", "an already-chosen template is not overridden");
});

test("importing rejects malformed templates", () => {
  const r = inCtx(`
    function threw(obj) { try { Templates.addUserTemplate(obj); return false; } catch (e) { return true; } }
    return {
      noName: threw({ goalData: [] }),
      noGoalData: threw({ name: "X" }),
      badGroups: threw({ name: "X", goalData: [], gearGroups: {} })
    };
  `);
  assert.strictEqual(r.noName, true, "a template without a name is rejected");
  assert.strictEqual(r.noGoalData, true, "a template without goalData is rejected");
  assert.strictEqual(r.badGroups, true, "non-list gearGroups is rejected");
});

test("importing the same template twice creates two distinct entries", () => {
  const r = inCtx(`
    const before = Templates.listTemplates().length;
    const a = Templates.addUserTemplate({ name: "Dup", goalData: [] });
    const b = Templates.addUserTemplate({ name: "Dup", goalData: [] });
    const after = Templates.listTemplates().length;
    Templates.removeUserTemplate(a.id);
    Templates.removeUserTemplate(b.id);
    return { added: after - before, distinct: a.id !== b.id };
  `);
  assert.strictEqual(r.added, 2, "both imports are kept");
  assert.strictEqual(r.distinct, true, "each import gets its own id");
});

test("templateFromCurrentProfile carries the profile's tier groups", () => {
  const r = inCtx(`
    createProfile("Geared", "ladlor");
    render();
    const tpl = templateFromCurrentProfile("Geared snapshot");
    Templates.applyTemplate("ladlor");
    return { groups: tpl.gearGroups.length, firstGroupHasMembers: (tpl.gearGroups[0] || []).length > 0 };
  `);
  assert.ok(r.groups > 0, "gear groups are captured from the profile");
  assert.strictEqual(r.firstGroupHasMembers, true, "captured groups keep their members");
});

console.log("\nTemplate versioning");

test("diffTemplates reports added, deleted, moved goals and new groups", () => {
  const r = JSON.parse(vm.runInContext(`JSON.stringify((function(){
    const oldC = {
      goalData: [
        { id: "a", title: "A", children: [ { id: "b", title: "B", children: [] } ] },
        { id: "c", title: "C", children: [] }
      ],
      gearGroups: [ ["a", "c"] ]
    };
    const newC = {
      goalData: [
        { id: "a", title: "A", children: [] },
        { id: "b", title: "B", children: [] },
        { id: "d", title: "D", children: [] }
      ],
      gearGroups: [ ["a", "c"], ["b", "d"] ]
    };
    return diffTemplates(oldC, newC);
  })())`, ctx));
  assert.deepStrictEqual(r.added, ["D"], "d is new");
  assert.deepStrictEqual(r.removed, ["C"], "c was deleted");
  assert.strictEqual(r.moved.length, 1, "b moved");
  assert.strictEqual(r.moved[0].title, "B");
  assert.strictEqual(r.moved[0].from, "A");
  assert.strictEqual(r.moved[0].to, "top level");
  assert.strictEqual(r.newGroups.length, 1, "one new group signature");
  assert.deepStrictEqual(r.newGroups[0], ["B", "D"], "new group lists member titles");
});

test("templateUpdateInfo warns only when the live version exceeds the pinned one", () => {
  const r = inCtx(`
    const t = Templates.addUserTemplate({ name: "Verd", goalData: [{ id: "x", title: "X", children: [] }] });
    const id = "p-ver";
    profilesMeta.profiles[id] = { name: "Ver", templateId: t.id, templateVersion: t.version };
    const same = templateUpdateInfo(id);
    Templates.updateUserTemplate(t.id, { name: "Verd", goalData: [{ id: "x", title: "X", children: [] }, { id: "z", title: "Z", children: [] }] });
    const behind = templateUpdateInfo(id);
    profilesMeta.profiles[id].dismissedVersion = Templates.getTemplate(t.id).version;
    const dismissed = templateUpdateInfo(id);
    delete profilesMeta.profiles[id];
    Templates.removeUserTemplate(t.id);
    return { same: !!same, behind: !!behind, dismissed: !!dismissed };
  `);
  assert.strictEqual(r.same, false, "no warning when pinned to the current version");
  assert.strictEqual(r.behind, true, "warns when pinned below the current version");
  assert.strictEqual(r.dismissed, false, "no warning once this version is dismissed");
});

test("__full__ profiles never warn (internal template)", () => {
  const r = inCtx(`
    const id = "p-full";
    profilesMeta.profiles[id] = { name: "Full", templateId: "__full__", templateVersion: 0 };
    const info = templateUpdateInfo(id);
    delete profilesMeta.profiles[id];
    return { info: !!info };
  `);
  assert.strictEqual(r.info, false, "the internal full template does not raise the banner");
});

test("applyTemplateUpdate re-pins the base snapshot and version, clearing dismissal", () => {
  const r = inCtx(`
    const id = "p-apply";
    profilesMeta.profiles[id] = { name: "Apply", templateId: "ladlor", templateVersion: 0, dismissedVersion: 0 };
    applyTemplateUpdate(id);
    const p = profilesMeta.profiles[id];
    const base = loadTemplateBase(id);
    const cur = Templates.getTemplate("ladlor").version || 1;
    const res = { version: p.templateVersion, dismissed: p.dismissedVersion, hasBase: !!(base && base.goalData.length), cur };
    delete profilesMeta.profiles[id];
    localStorage.removeItem(baseKeyFor(id));
    return res;
  `);
  assert.strictEqual(r.version, r.cur, "pins to the current template version");
  assert.strictEqual(r.dismissed, undefined, "clears any prior dismissal");
  assert.strictEqual(r.hasBase, true, "writes the new base snapshot");
});

test("createProfile pins a base snapshot and version", () => {
  const r = inCtx(`
    createProfile("Pinned", "ladlor");
    const id = profilesMeta.activeId;
    const p = profilesMeta.profiles[id];
    const base = loadTemplateBase(id);
    return { version: p.templateVersion, hasBase: !!(base && base.goalData.length) };
  `);
  assert.ok(r.version >= 1, "records the template version");
  assert.strictEqual(r.hasBase, true, "stores the starting content snapshot");
});

test("updateUserTemplate bumps the version in place, keeping the id", () => {
  const r = inCtx(`
    const a = Templates.addUserTemplate({ name: "Editable", goalData: [{ id: "x", title: "X", children: [] }] });
    const v1 = a.version;
    const b = Templates.updateUserTemplate(a.id, { name: "Editable", goalData: [{ id: "x", title: "X", children: [] }, { id: "y", title: "Y", children: [] }] });
    Templates.removeUserTemplate(a.id);
    return { sameId: a.id === b.id, v1, v2: b.version, goals: (b.goalData || []).length };
  `);
  assert.strictEqual(r.sameId, true, "keeps the same template id");
  assert.strictEqual(r.v2, r.v1 + 1, "bumps the version by one");
  assert.strictEqual(r.goals, 2, "adopts the new content");
});

test("mergeTemplateContent unions goals and groups, keeping the base's own copy of shared ids", () => {
  const r = JSON.parse(vm.runInContext(`JSON.stringify((function(){
    const base = {
      goalData: [ { id: "a", title: "A (mine)", children: [] }, { id: "b", title: "B", children: [] } ],
      gearGroups: [ ["a", "b"] ]
    };
    const add = {
      goalData: [ { id: "a", title: "A (template)", children: [] }, { id: "c", title: "C", children: [] } ],
      gearGroups: [ ["a", "b"], ["c", "d"] ]
    };
    return mergeTemplateContent(base, add);
  })())`, ctx));
  assert.deepStrictEqual(r.goalData.map(n => n.id), ["a", "b", "c"], "adds only ids new to the base");
  assert.strictEqual(r.goalData[0].title, "A (mine)", "keeps the base's copy of a shared id");
  assert.strictEqual(r.gearGroups.length, 2, "appends only the group with a new signature");
});

test("changeProfileTemplate replaces the base and re-pins to the selected template", () => {
  const r = inCtx(`
    const t = Templates.addUserTemplate({ name: "Swap", goalData: [{ id: "swap-goal", title: "Swap", children: [] }] });
    createProfile("ToSwap", "ladlor");
    const id = profilesMeta.activeId;
    changeProfileTemplate(id, t.id, "replace");
    const p = profilesMeta.profiles[id];
    const base = loadTemplateBase(id);
    const ids = (base.goalData || []).map(n => n.id);
    const tid = t.id;
    Templates.removeUserTemplate(t.id);
    return { pinned: p.templateId, tid, version: p.templateVersion, onlyNew: ids.length === 1 && ids[0] === "swap-goal" };
  `);
  assert.strictEqual(r.pinned, r.tid, "pins to the selected template id");
  assert.ok(r.version >= 1, "records the selected template's version");
  assert.strictEqual(r.onlyNew, true, "replace swaps the base for the selected template's content");
});

test("performUndo rolls back a changeProfileTemplate: pin, version, and base snapshot", () => {
  const r = inCtx(`
    const t = Templates.addUserTemplate({ name: "Undo", goalData: [{ id: "undo-goal", title: "Undo", children: [] }] });
    createProfile("ToUndo", "ladlor");
    const id = profilesMeta.activeId;
    const ladlorVer = Templates.getTemplate("ladlor").version || 1;
    changeProfileTemplate(id, t.id, "replace");
    const changedPin = profilesMeta.profiles[id].templateId;
    const changedIds = (loadTemplateBase(id).goalData || []).map(n => n.id);
    performUndo();
    const p = profilesMeta.profiles[id];
    const undoneIds = (loadTemplateBase(id).goalData || []).map(n => n.id);
    Templates.removeUserTemplate(t.id);
    return {
      tid: t.id, ladlorVer,
      changedPin, changedToSwap: changedIds.length === 1 && changedIds[0] === "undo-goal",
      undonePin: p.templateId, undoneVer: p.templateVersion,
      undoneHasSwap: undoneIds.indexOf("undo-goal") !== -1, undoneCount: undoneIds.length
    };
  `);
  assert.strictEqual(r.changedPin, r.tid, "the change repins to the user template");
  assert.strictEqual(r.changedToSwap, true, "the change swaps the base to the user template");
  assert.strictEqual(r.undonePin, "ladlor", "undo restores the original pin");
  assert.strictEqual(r.undoneVer, r.ladlorVer, "undo restores the original template version");
  assert.strictEqual(r.undoneHasSwap, false, "undo drops the applied template's base content");
  assert.ok(r.undoneCount > 1, "undo restores the original (ladlor) base snapshot");
});

test("updating to a template that dropped a group ungroups the goal in the save", () => {
  const r = inCtx(`
    const t = Templates.addUserTemplate({ name: "Grp", goalData: [
      { id: "a", title: "A", type: "quest", children: [] },
      { id: "b", title: "B", type: "quest", children: [] }
    ], gearGroups: [["a", "b"]] });
    createProfile("GrpP", t.id);
    render(); // seeds groupsState from the template's group
    const grouped = getGroupOf("a") !== null && getGroupOf("b") !== null;
    // new template version drops the group entirely (both goals ungrouped)
    Templates.updateUserTemplate(t.id, { name: "Grp", goalData: [
      { id: "a", title: "A", type: "quest", children: [] },
      { id: "b", title: "B", type: "quest", children: [] }
    ], gearGroups: [] });
    applyTemplateUpdate(profilesMeta.activeId);
    return { grouped, aAfter: getGroupOf("a"), bAfter: getGroupOf("b") };
  `);
  assert.strictEqual(r.grouped, true, "the goals start grouped from the template");
  assert.strictEqual(r.aAfter, null, "goal a is ungrouped after the update, matching the template");
  assert.strictEqual(r.bAfter, null, "goal b is ungrouped after the update, matching the template");
});

test("a template update leaves groups it did not change untouched", () => {
  const r = inCtx(`
    const t = Templates.addUserTemplate({ name: "Keep", goalData: [
      { id: "a", title: "A", type: "quest", children: [] },
      { id: "b", title: "B", type: "quest", children: [] },
      { id: "c", title: "C", type: "quest", children: [] }
    ], gearGroups: [["a", "b"]] });
    createProfile("KeepP", t.id);
    render();
    // update only adds goal c; the [a,b] group is unchanged
    Templates.updateUserTemplate(t.id, { name: "Keep", goalData: [
      { id: "a", title: "A", type: "quest", children: [] },
      { id: "b", title: "B", type: "quest", children: [] },
      { id: "c", title: "C", type: "quest", children: [] }
    ], gearGroups: [["a", "b"]] });
    applyTemplateUpdate(profilesMeta.activeId);
    return { sameGroup: getGroupOf("a") !== null && getGroupOf("a") === getGroupOf("b") };
  `);
  assert.strictEqual(r.sameGroup, true, "the unchanged [a,b] group survives the update");
});

test("mergeTemplateUpdateBase keeps base-only goals, adopts template field changes, adds new template goals", () => {
  const r = JSON.parse(vm.runInContext(`JSON.stringify((function(){
    const oldBase = {
      goalData: [
        { id: "a", title: "A old", type: "other", children: [] },
        { id: "extra", title: "Extra", type: "other", children: [ { id: "extra.kid", title: "Kid", type: "other", children: [] } ] }
      ],
      gearGroups: [ ["a", "extra"] ]
    };
    const tpl = {
      goalData: [ { id: "a", title: "A new", type: "item", children: [] }, { id: "b", title: "B", type: "item", children: [] } ],
      gearGroups: [ ["a", "b"] ]
    };
    return mergeTemplateUpdateBase(oldBase, tpl);
  })())`, ctx));
  const byId = {}; r.goalData.forEach(n => byId[n.id] = n);
  assert.ok(byId.a && byId.b && byId.extra, "keeps base extra + adds the new template goal");
  assert.strictEqual(byId.a.title, "A new", "adopts the template's updated title for a shared id");
  assert.strictEqual(byId.a.type, "item", "adopts the template's type change (other -> item)");
  assert.ok(byId.extra.children.length === 1 && byId.extra.children[0].id === "extra.kid", "a base-only sub-tree is preserved intact");
});

test("applyTemplateUpdate preserves base sub-trees the template omits and custom nodes under them", () => {
  // Regression for the TuuxSolo data loss: updating a profile whose base is a
  // superset of the template must not wipe the extra goals (a merged full sub-tree)
  // nor orphan custom goals hung off them.
  const r = inCtx(`
    const t = Templates.addUserTemplate({ name: "Upd", goalData: [ { id: "a", title: "A", type: "quest", children: [] } ], gearGroups: [] });
    createProfile("UpdP", t.id);
    const pid = profilesMeta.activeId;
    // Simulate a merged/superset base: a sub-tree the template does not contain.
    const base = loadTemplateBase(pid);
    base.goalData.push({ id: "tree", title: "Tree", type: "quest", children: [ { id: "tree.leaf", title: "Leaf", type: "quest", children: [] } ] });
    saveTemplateBase(pid, base);
    applyProfileTemplate(pid); render();
    addCustomChild("tree.leaf", "MyCustom", { type: "quest" });
    const cid = Object.keys(state.customNodes).find(id => state.customNodes[id].title === "MyCustom");
    render(); saveState();
    // A new template version (still without "tree") adds goal "b".
    Templates.updateUserTemplate(t.id, { name: "Upd", goalData: [ { id: "a", title: "A", type: "quest", children: [] }, { id: "b", title: "B", type: "quest", children: [] } ], gearGroups: [] });
    applyTemplateUpdate(pid);
    const g = getGraph().nodes;
    const res = { treeThere: !!g["tree"], leafThere: !!g["tree.leaf"],
      customUnderLeaf: g[cid] ? g[cid].parentIds.includes("tree.leaf") : false, bAdded: !!g["b"] };
    Templates.removeUserTemplate(t.id);
    Templates.applyTemplate("ladlor");
    return res;
  `);
  assert.strictEqual(r.treeThere, true, "the base-only sub-tree survives the update");
  assert.strictEqual(r.leafThere, true, "its nested goal survives");
  assert.strictEqual(r.customUnderLeaf, true, "a custom goal stays nested under the preserved sub-tree");
  assert.strictEqual(r.bAdded, true, "the template's new goal is still added");
});

console.log("\nBank memory sync");

test("normalizeItemName drops (number) charge suffixes but keeps (letters) variants", () => {
  const r = inCtx(`
    return {
      glory: normalizeItemName("Amulet of glory(6)"),
      glorySpace: normalizeItemName("Amulet of glory (6)"),
      salve: normalizeItemName("Salve amulet(ei)"),
      iban: normalizeItemName("Iban's staff (u)"),
      karamja: normalizeItemName("Karamja gloves 4")
    };
  `);
  assert.strictEqual(r.glory, "amulet of glory", "(6) charge suffix stripped");
  assert.strictEqual(r.glorySpace, "amulet of glory", "space before (6) collapsed away");
  assert.strictEqual(r.salve, "salve amulet(ei)", "(ei) letter variant kept");
  assert.strictEqual(r.iban, "iban's staff (u)", "(u) letter variant kept");
  assert.strictEqual(r.karamja, "karamja gloves 4", "un-parenthesized number untouched");
});

test("parseBankMemory reads tab rows, skips the header, sums quantities", () => {
  const r = inCtx(`
    const bank = parseBankMemory([
      "Item id\\tItem name\\tItem quantity",
      "556\\tAir rune\\t477",
      "555\\tWater rune\\t12324",
      "",
      "563\\tLaw rune\\t1645"
    ].join("\\n"));
    return { air: bank["air rune"], water: bank["water rune"], law: bank["law rune"], keys: Object.keys(bank).length };
  `);
  assert.strictEqual(r.air, 477, "air rune quantity parsed");
  assert.strictEqual(r.water, 12324, "water rune quantity parsed");
  assert.strictEqual(r.law, 1645, "law rune quantity parsed");
  assert.strictEqual(r.keys, 3, "header and blank line skipped");
});

test("applyBankSync completes only item goals present in the bank, never unchecks", () => {
  const r = inCtx(`
    state.bank = { "air rune": 477, "rune pouch": 1 };
    currentNodes = {
      a: { id: "a", title: "Air rune", type: "item" },
      b: { id: "b", title: "Rune pouch", type: "item" },
      c: { id: "c", title: "Air rune", type: "other" },
      d: { id: "d", title: "Fire rune", type: "item" }
    };
    const changed = applyBankSync();
    return { changed, a: !!state.done.a, b: !!state.done.b, c: !!state.done.c, d: !!state.done.d };
  `);
  assert.strictEqual(r.changed, 2, "two item goals completed");
  assert.strictEqual(r.a, true, "item in bank is completed");
  assert.strictEqual(r.b, true, "second item in bank is completed");
  assert.strictEqual(r.c, false, "same-name non-item goal is left alone");
  assert.strictEqual(r.d, false, "item absent from the bank stays incomplete");
});

test("state.bank defaults to {} and round-trips through loadState", () => {
  const r = inCtx(`
    const def = defaultState().bank;
    const key = storageKeyFor(profilesMeta.activeId);
    localStorage.setItem(key, JSON.stringify({ done: {}, bank: { "air rune": 477 } }));
    const loaded = loadState();
    localStorage.removeItem(key);
    return { defIsObj: def && typeof def === "object" && Object.keys(def).length === 0, air: loaded.bank["air rune"] };
  `);
  assert.strictEqual(r.defIsObj, true, "defaultState seeds an empty bank");
  assert.strictEqual(r.air, 477, "a saved bank survives load");
});

test("applyBankSync matches a (6)-charge bank entry to a plain item goal title", () => {
  const r = inCtx(`
    state.bank = parseBankMemory("1704\\tAmulet of glory(6)\\t3");
    currentNodes = { g: { id: "g", title: "Amulet of glory", type: "item" } };
    const changed = applyBankSync();
    return { changed, g: !!state.done.g };
  `);
  assert.strictEqual(r.changed, 1, "charge-suffixed bank item matches the plain goal");
  assert.strictEqual(r.g, true, "goal completed");
});

console.log("\n" + passed + " test(s) passed.");
if (process.exitCode) console.error("Some app tests failed.");
else console.log("All app tests passed.");
