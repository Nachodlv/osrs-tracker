#!/usr/bin/env node
// Regression test for save-data migration. Run with: node test-migration.js
// Run after any id rename/restructure in data.js to confirm old saves
// (including TuuxSolo-shaped ones) still load correctly.

const assert = require("assert");
const { ID_MIGRATIONS, remapId, migrateStateData } = require("./migration.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok - " + name);
  } catch (e) {
    console.error("  FAIL - " + name);
    console.error("    " + e.message);
    process.exitCode = 1;
  }
}

console.log("Migration table sanity");
test("has a non-trivial number of entries", () => {
  assert.ok(Object.keys(ID_MIGRATIONS).length > 100, "expected 100+ migration entries");
});
test("gear-progression.* entries flatten to a gear.* id", () => {
  Object.entries(ID_MIGRATIONS).forEach(([oldId, newId]) => {
    if (oldId.startsWith("gear-progression.")) {
      assert.ok(newId.startsWith("gear."), `${newId} should start with "gear."`);
    }
  });
});
test("no migration maps to itself", () => {
  Object.entries(ID_MIGRATIONS).forEach(([oldId, newId]) => {
    assert.notStrictEqual(oldId, newId, `${oldId} maps to itself`);
  });
});
test("no migration target is itself a migration source (single-pass safe)", () => {
  const sources = new Set(Object.keys(ID_MIGRATIONS));
  Object.values(ID_MIGRATIONS).forEach(newId => {
    assert.ok(!sources.has(newId), `${newId} is both a target and a source (needs chaining)`);
  });
});

console.log("\nremapId()");
test("rewrites a known old id", () => {
  assert.strictEqual(remapId("gear-progression.tier52.twisted-bow"), "gear.twisted-bow");
});
test("passes through an id with no mapping unchanged", () => {
  assert.strictEqual(remapId("herb-run"), "herb-run");
  assert.strictEqual(remapId("gear.twisted-bow"), "gear.twisted-bow");
});

console.log("\nmigrateStateData() — synthetic 'TuuxSolo' profile");

function makeTuuxSoloSave() {
  // Shaped like a real save from before the gear-progression flattening: ids
  // reference the old nested "gear-progression.tier*" scheme.
  return {
    done: {
      "gear-progression.tier52.twisted-bow": true,
      "gear-progression.tier0.amulet-of-strength": true,
      "herb-run.weiss.arm": true // an id that was never renamed, must survive untouched
    },
    inProgress: {
      "gear-progression.tier16.69-slayer": true
    },
    order: {
      "gear-progression.tier0.amulet-of-strength": 3
    },
    customNodes: {
      "custom-1": {
        id: "custom-1",
        parentId: "gear-progression.tier0.amulet-of-strength",
        title: "Buy from GE"
      },
      "custom-2": {
        id: "custom-2",
        parentId: "herb-run.weiss.arm", // unrenamed id, should pass through
        title: "Note"
      }
    },
    linkedEdges: {
      "gear-progression.tier5.piety": ["gear-progression.tier0.rune-pouch"]
    },
    collapsed: { "gear-progression.tier52.twisted-bow": false },
    overrides: {},
    removed: {}
  };
}

test("remaps every reference in done/inProgress/order/collapsed", () => {
  const migrated = migrateStateData(makeTuuxSoloSave());
  assert.deepStrictEqual(Object.keys(migrated.done).sort(), [
    "gear.amulet-of-strength",
    "gear.twisted-bow",
    "herb-run.weiss.arm"
  ].sort());
  assert.strictEqual(migrated.done["gear.twisted-bow"], true);
  assert.strictEqual(migrated.done["herb-run.weiss.arm"], true);
  assert.strictEqual(migrated.inProgress["gear.69-slayer"], true);
  assert.strictEqual(migrated.order["gear.amulet-of-strength"], 3);
  assert.strictEqual(migrated.collapsed["gear.twisted-bow"], false);
});

test("remaps customNodes[*].parentId, leaves unrenamed ids alone", () => {
  const migrated = migrateStateData(makeTuuxSoloSave());
  assert.strictEqual(migrated.customNodes["custom-1"].parentId, "gear.amulet-of-strength");
  assert.strictEqual(migrated.customNodes["custom-2"].parentId, "herb-run.weiss.arm");
  assert.strictEqual(migrated.customNodes["custom-1"].title, "Buy from GE", "title must be untouched");
});

test("remaps linkedEdges keys and values", () => {
  const migrated = migrateStateData(makeTuuxSoloSave());
  assert.deepStrictEqual(migrated.linkedEdges, { "gear.piety": ["gear.rune-pouch"] });
});

test("does not lose or duplicate any done entries", () => {
  const before = makeTuuxSoloSave();
  const doneCountBefore = Object.keys(before.done).length;
  const migrated = migrateStateData(before);
  assert.strictEqual(Object.keys(migrated.done).length, doneCountBefore);
});

test("is idempotent — migrating twice gives the same result as once", () => {
  const once = migrateStateData(makeTuuxSoloSave());
  const twice = migrateStateData(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice, once);
});

test("a save with no renamed ids at all passes through unchanged", () => {
  const clean = {
    done: { "herb-run.weiss.arm": true },
    inProgress: {},
    order: {},
    customNodes: {},
    linkedEdges: {},
    collapsed: {},
    overrides: {},
    removed: {}
  };
  const migrated = migrateStateData(JSON.parse(JSON.stringify(clean)));
  assert.deepStrictEqual(migrated, clean);
});

test("remaps removedEdges keys and values", () => {
  const save = makeTuuxSoloSave();
  save.removedEdges = { "gear-progression.tier5.piety": ["gear-progression.tier0.rune-pouch", "herb-run.weiss.arm"] };
  const migrated = migrateStateData(save);
  assert.deepStrictEqual(migrated.removedEdges, { "gear.piety": ["gear.rune-pouch", "herb-run.weiss.arm"] });
});

test("remaps ids inside groupsState.groups", () => {
  const save = makeTuuxSoloSave();
  save.groupsState = { groupOrder: ["g0"], groups: { g0: ["gear-progression.tier0.amulet-of-strength", "herb-run.weiss.arm"] } };
  const migrated = migrateStateData(save);
  assert.deepStrictEqual(migrated.groupsState.groups.g0, ["gear.amulet-of-strength", "herb-run.weiss.arm"]);
});

test("remaps rootGoals keys", () => {
  const save = makeTuuxSoloSave();
  save.rootGoals = { "gear-progression.tier5.piety": true, "herb-run.weiss.arm": true };
  const migrated = migrateStateData(save);
  assert.deepStrictEqual(migrated.rootGoals, { "gear.piety": true, "herb-run.weiss.arm": true });
});

test("remaps the Ladlord spirit-tree / hallowed-shard rename, sub-goals included", () => {
  const save = {
    done: {
      "spirit-tree": true,
      "spirit-tree.75construction": true,
      "hallowed-shard.sepulchre.sins.50slayer": true,
      "herb-run.weiss.arm": true // unrenamed, must survive
    },
    collapsed: { "hallowed-shard": true },
    linkedEdges: { "spirit-tree.83farming": ["hallowed-shard.sepulchre"] },
    rootGoals: { "hallowed-shard.sepulchre.sins": true }
  };
  const m = migrateStateData(save);
  assert.strictEqual(m.done["spirit-tree-construction"], true);
  assert.strictEqual(m.done["spirit-tree-construction.75construction"], true);
  assert.strictEqual(m.done["hallowed-crystal-shard.sepulchre.sins.50slayer"], true);
  assert.strictEqual(m.done["herb-run.weiss.arm"], true);
  assert.ok(!("spirit-tree" in m.done), "old spirit-tree id must be gone");
  assert.strictEqual(m.collapsed["hallowed-crystal-shard"], true);
  assert.deepStrictEqual(m.linkedEdges, {
    "spirit-tree-construction.83farming": ["hallowed-crystal-shard.sepulchre"]
  });
  assert.deepStrictEqual(m.rootGoals, { "hallowed-crystal-shard.sepulchre.sins": true });
});

test("handles a missing/undefined state gracefully (no crash)", () => {
  assert.strictEqual(migrateStateData(null), null);
  assert.strictEqual(migrateStateData(undefined), undefined);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error("\nSome migration tests FAILED — saved profiles (including TuuxSolo-shaped ones) may lose progress. Do not ship until this is green.");
} else {
  console.log("All migration tests passed.");
}
