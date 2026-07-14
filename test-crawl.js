// Node test runner for the Ladlor crawl tool's pure logic (no browser/network):
// classifyGroups (auto-add vs review classification) and applyNewGoals (the
// data.js text writer). The rendering path needs Chrome and is not covered here.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { classifyGroups, applyNewGoals, canonId, splitStaleIds,
  slugify, repoGroupsShape, repoTitleMap, goalFromMember, retypeItems } = require("./tools/crawl-ladlor");

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

const member = slug => ({
  slug, title: slug, canon: canonId(slug),
  wiki: "https://oldschool.runescape.wiki/w/" + slug,
  icon: "https://oldschool.runescape.wiki/images/" + slug + ".png"
});
const dataGroup = (...ids) => ({ ids, canon: ids.map(canonId) });
const idMapOf = (...ids) => new Map(ids.map(id => [canonId(id), id]));

// 1. Purely additive: a new member joins an existing tier (no removals).
{
  const { plan } = classifyGroups(
    idMapOf("gear.a", "gear.b"),
    [[member("a"), member("b"), member("c-new")]],
    [dataGroup("gear.a", "gear.b")]
  );
  assert(plan.goals.length === 1 && plan.goals[0].id === "gear.c-new", "additive: one new goal");
  assert(plan.tierAppends.length === 1 && plan.tierAppends[0].anchor === "gear.a" &&
    plan.tierAppends[0].ids[0] === "gear.c-new", "additive: appended to existing tier");
  assert(plan.reviewLines.length === 0, "additive: nothing to review");
}

// 2. Rename: a tier loses a member and gains an unknown one -> review, never auto.
{
  const { plan } = classifyGroups(
    idMapOf("gear.a", "gear.old"),
    [[member("a"), member("new-name")]],
    [dataGroup("gear.a", "gear.old")]
  );
  assert(plan.goals.length === 0, "rename: nothing auto-added");
  assert(plan.reviewLines.some(l => /possible rename/.test(l)), "rename: flagged for review");
}

// 3. A wholly-new tier at the end, nothing gone -> auto-add, appended (before null).
{
  const { plan } = classifyGroups(
    idMapOf("gear.a"),
    [[member("a")], [member("x-new"), member("y-new")]],
    [dataGroup("gear.a")]
  );
  assert(plan.newTiers.length === 1 && plan.newTiers[0].ids.join(",") === "gear.x-new,gear.y-new",
    "new tier: added with both members");
  assert(plan.newTiers[0].before === null, "new tier at end: before is null (append)");
  assert(plan.goals.length === 2 && plan.reviewLines.length === 0, "new tier: two goals, no review");
}

// 3b. A new tier in the middle -> before is the next existing tier's anchor.
{
  const { plan } = classifyGroups(
    idMapOf("gear.a", "gear.b"),
    [[member("a")], [member("mid-new")], [member("b")]],
    [dataGroup("gear.a"), dataGroup("gear.b")]
  );
  assert(plan.newTiers.length === 1 && plan.newTiers[0].before === "gear.b",
    "new tier in middle: before is the following tier's anchor");
}

// 4. A new group while another group went missing -> review (possible restructure).
{
  const { plan } = classifyGroups(
    idMapOf("gear.a", "gear.gone"),
    [[member("a")], [member("z-new")]],
    [dataGroup("gear.a"), dataGroup("gear.gone")]
  );
  assert(plan.newTiers.length === 0 && plan.goals.length === 0, "ambiguous new group: not auto-added");
  assert(plan.reviewLines.length >= 1, "ambiguous new group: flagged for review");
}

// 5. Level-requirement type: "69-slayer" is a skill, plain gear is "other".
{
  const { plan } = classifyGroups(
    idMapOf("gear.a"),
    [[member("a"), member("70-ranged")]],
    [dataGroup("gear.a")]
  );
  const g = plan.goals.find(x => x.id === "gear.70-ranged");
  assert(g && g.type === "skill", "type: level requirement is skill");
}

// 5b. splitStaleIds: title-dict ids that render in no node are stale, not drift.
{
  const onlyLive = [
    { id: "spirit-tree-construction", title: "Spirit tree (Construction)" }, // grouped + rendered
    { id: "brand-new-gear", title: "Brand new gear" },                       // ungrouped but rendered
    { id: "ghommals-hilt-5", title: "Ghommal's hilt 5" },                    // in the map, not rendered
    { id: "greater-challenge", title: "Greater Challenge" }                  // in the map, not rendered
  ];
  const groupedCanon = new Set([canonId("spirit-tree-construction")]);
  const renderedCanon = new Set([canonId("spirit-tree-construction"), canonId("brand-new-gear")]);
  const { fresh, stale } = splitStaleIds(onlyLive, groupedCanon, renderedCanon);
  assert(fresh.length === 1 && fresh[0].id === "brand-new-gear",
    "splitStaleIds: rendered ungrouped id is fresh (grouped id excluded)");
  assert(stale.length === 2 && stale.every(g => /ghommals-hilt-5|greater-challenge/.test(g.id)),
    "splitStaleIds: unrendered title-dict ids are stale");
}

// 7. slugify matches the ids ladlorchart.com renders (drops ' and (), collapses
//    other punctuation to single hyphens, strips a leading "*").
{
  assert(slugify("Amulet of strength") === "amulet-of-strength", "slugify: spaces");
  assert(slugify("Iban's staff (u)") === "ibans-staff-u", "slugify: apostrophe + parens");
  assert(slugify("Salve amulet(ei)") === "salve-amuletei", "slugify: glued parens");
  assert(slugify("*Dragon hunter lance") === "dragon-hunter-lance", "slugify: leading star stripped");
  assert(slugify("69 Slayer") === "69-slayer", "slugify: numeric skill req");
}

// 8. repoGroupsShape: seq (arrays of titles) + meta (title -> icon/wiki) become
//    the { groups, rendered } shape fetchLiveGroups produces; "*" items dropped.
{
  const seq = [
    ["Amulet of strength", "Climbing boots"],
    ["Ferocious gloves", "*Dragon hunter lance"],
    ["69 Slayer"]
  ];
  const meta = {
    "Amulet of strength": { wikiUrl: "https://w/Amulet_of_strength", imgUrl: "https://img/Amulet_of_strength.png", type: "item" },
    "Climbing boots": { wikiUrl: "https://w/Climbing_boots", imgUrl: "https://img/Climbing_boots.png", type: "item" },
    "Ferocious gloves": { wikiUrl: "https://w/Ferocious_gloves", imgUrl: "https://img/Ferocious_gloves.png", type: "item" },
    "Dragon hunter lance": { wikiUrl: "https://w/Dragon_hunter_lance", imgUrl: "https://img/Dragon_hunter_lance.png", type: "item" }
  };
  const { groups, rendered } = repoGroupsShape({ seq, meta });
  assert(groups.length === 3, "repoGroupsShape: three groups");
  assert(groups[0][0].id === "amulet-of-strength" && groups[0][0].icon === "https://img/Amulet_of_strength.png" &&
    groups[0][0].wiki === "https://w/Amulet_of_strength", "repoGroupsShape: id/icon/wiki resolved from meta");
  assert(groups[1].length === 1 && groups[1][0].id === "ferocious-gloves",
    "repoGroupsShape: *-annotated member dropped to match live");
  const skill = groups[2][0];
  assert(skill.id === "69-slayer" && skill.icon === "" && skill.wiki === "",
    "repoGroupsShape: skill-req has empty icon/wiki (no meta entry)");
  assert(!rendered.includes("dragon-hunter-lance") && rendered.includes("ferocious-gloves"),
    "repoGroupsShape: rendered excludes *-annotated, includes real members");
}

// 9. repoTitleMap: slug -> title over the same grouped, non-"*" items.
{
  const seq = [["Amulet of strength"], ["*Dragon hunter lance"]];
  const map = repoTitleMap({ seq, meta: {} });
  assert(map["amulet-of-strength"] === "Amulet of strength", "repoTitleMap: slug maps to title");
  assert(!("dragon-hunter-lance" in map), "repoTitleMap: *-annotated omitted");
}

// 6. applyNewGoals writes valid data.js: append to a tier + add a new tier.
{
  const tmp = path.join(os.tmpdir(), "data-crawltest-" + Date.now() + ".js");
  fs.copyFileSync(path.join(__dirname, "data.js"), tmp);
  const plan = {
    goals: [
      { id: "gear.test-widget", title: "Test widget", type: "other", icon: "Test_widget.png", link: "https://oldschool.runescape.wiki/w/Test_widget" },
      { id: "gear.test-solo", title: "Test solo", type: "other", icon: "Test_solo.png", link: "https://oldschool.runescape.wiki/w/Test_solo" },
      { id: "gear.test-mid", title: "Test mid", type: "other", icon: "Test_mid.png", link: "https://oldschool.runescape.wiki/w/Test_mid" }
    ],
    tierAppends: [{ anchor: "gear.amulet-of-strength", ids: ["gear.test-widget"] }],
    // one appended at the end, one inserted before an existing tier's anchor
    newTiers: [
      { ids: ["gear.test-solo"], before: null },
      { ids: ["gear.test-mid"], before: "gear.dragon-scimitar" }
    ],
    reviewLines: []
  };
  const added = applyNewGoals(plan, tmp);
  assert(added === 3, "applyNewGoals: reported 3 goals added");

  const out = fs.readFileSync(tmp, "utf8");
  let data = null;
  try { data = new Function(out + "\nreturn { GOAL_DATA, GEAR_GROUPS };")(); }
  catch (e) { console.error("parse error: " + e.message); }
  assert(!!data, "applyNewGoals: result is valid, loadable JS");
  if (data) {
    const ids = new Set(data.GOAL_DATA.map(n => n.id));
    assert(ids.has("gear.test-widget") && ids.has("gear.test-solo") && ids.has("gear.test-mid"),
      "applyNewGoals: goals present in GOAL_DATA");
    const tier = data.GEAR_GROUPS.find(t => t.includes("gear.amulet-of-strength"));
    assert(tier && tier.includes("gear.test-widget"), "applyNewGoals: appended id to the existing tier");
    assert(data.GEAR_GROUPS.some(t => t.length === 1 && t[0] === "gear.test-solo"), "applyNewGoals: appended new tier present");
    // positional: gear.test-mid inserted immediately before the dragon-scimitar tier
    const midIdx = data.GEAR_GROUPS.findIndex(t => t.length === 1 && t[0] === "gear.test-mid");
    const scimIdx = data.GEAR_GROUPS.findIndex(t => t.includes("gear.dragon-scimitar"));
    assert(midIdx >= 0 && midIdx === scimIdx - 1, "applyNewGoals: new tier inserted at its live position");
    const w = data.GOAL_DATA.find(n => n.id === "gear.test-widget");
    assert(w && w.icon === "Test_widget.png" && Array.isArray(w.children) && w.children.length === 0,
      "applyNewGoals: goal fields intact");
  }
  fs.rmSync(tmp, { force: true });
}

// 10. goalFromMember maps the source metadata type: ownable item -> "item",
//     prayer/spell/etc. -> "other", numeric level requirement -> "skill".
{
  const item = goalFromMember({ slug: "dragon-scimitar", title: "Dragon scimitar", wiki: "w", icon: "https://img/Dragon_scimitar.png", type: "item" });
  assert(item.type === "item" && item.id === "gear.dragon-scimitar" && item.icon === "Dragon_scimitar.png",
    "goalFromMember: metadata item -> type item");
  assert(goalFromMember({ slug: "piety", title: "Piety", wiki: "w", icon: "p", type: "prayer" }).type === "other",
    "goalFromMember: prayer -> type other");
  assert(goalFromMember({ slug: "ice-barrage", title: "Ice Barrage", wiki: "w", icon: "i", type: "spell" }).type === "other",
    "goalFromMember: spell -> type other");
  assert(goalFromMember({ slug: "69-slayer", title: "69 Slayer", wiki: "", icon: "", type: "" }).type === "skill",
    "goalFromMember: level requirement -> type skill");
}

// 11. retypeItems flips only gear.* "other" entries whose title is an ownable item
//     (case/punctuation-insensitive), leaving prayers ("other") and skills untouched.
{
  const src = [
    'var GOAL_DATA = [',
    '  { id: "gear.dragon-scimitar", title: "Dragon scimitar", type: "other", icon: "x.png", link: "l", children: [] },',
    '  { id: "gear.piety", title: "Piety", type: "other", icon: "p.png", link: "l", children: [] },',
    '  { id: "gear.69-slayer", title: "69 Slayer", type: "skill", icon: "", link: "", children: [] },',
    '  { id: "gear.salve-amulet-ei", title: "Salve amulet(ei)", type: "other", icon: "s.png", link: "l", children: [] }',
    "];"
  ].join("\n");
  const { src: out, count } = retypeItems(src, ["Dragon scimitar", "Salve amulet (ei)"]);
  assert(count === 2, "retypeItems: two entries retyped");
  assert(/gear\.dragon-scimitar", title: "Dragon scimitar", type: "item"/.test(out), "retypeItems: item flipped");
  assert(/gear\.salve-amulet-ei", title: "Salve amulet\(ei\)", type: "item"/.test(out),
    "retypeItems: punctuation/space-insensitive title match");
  assert(/gear\.piety", title: "Piety", type: "other"/.test(out), "retypeItems: prayer left as other");
  assert(/gear\.69-slayer", title: "69 Slayer", type: "skill"/.test(out), "retypeItems: skill untouched");
  assert(retypeItems(out, ["Dragon scimitar", "Salve amulet (ei)"]).count === 0, "retypeItems: idempotent");
}

if (failed) { console.error(`\n${failed} test(s) failed.`); process.exitCode = 1; }
else { console.log(`\n${passed} test(s) passed.\nAll crawl tests passed.`); }
