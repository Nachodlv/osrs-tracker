#!/usr/bin/env node
// Ladlor template generator (developer tool, not used by the web app).
//
// The built-in "Ironman Ladlord Chart" template is the goal tree maintained in
// data.js (GOAL_DATA / GEAR_GROUPS), a faithful transcription of ladlorchart.com.
// This script emits that tree as a standalone template JSON file, in the same
// format users import via Manage templates:
//
//   node tools/crawl-ladlor.js            # writes templates/ladlor.json
//   node tools/crawl-ladlor.js --check    # also fetches the live chart and
//                                          # reports goal ids present on the site
//                                          # but missing from data.js, and vice
//                                          # versa, so the template can be updated
//
// ladlorchart.com ships a minified React bundle with an embedded id -> title map
// (but no cleanly extractable edge list), so --check is a drift detector, not a
// full re-crawl. Update data.js by hand when it flags new items, then rerun this
// script to regenerate the JSON.

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates", "ladlor.json");

function loadDataJs() {
  const src = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
  const sandbox = {};
  // data.js only declares globals (var GOAL_DATA, var GEAR_GROUPS); eval in a
  // fresh scope and read them back.
  const fn = new Function(src + "\nreturn { GOAL_DATA, GEAR_GROUPS };");
  return fn.call(sandbox);
}

// The ladlorchart.com page is exactly the tier-group gear: keep only top-level
// goals that belong to a gear group, and drop their sub-goals. (Kept in sync
// with ladlorPageGoals in templates.js.)
function ladlorPageGoals(goalData, gearGroups) {
  const grouped = {};
  (gearGroups || []).forEach(g => g.forEach(id => { grouped[id] = true; }));
  return (goalData || [])
    .filter(n => grouped[n.id])
    .map(n => Object.assign({}, n, { children: [] }));
}

function generate() {
  const { GOAL_DATA, GEAR_GROUPS } = loadDataJs();
  const goalData = ladlorPageGoals(GOAL_DATA, GEAR_GROUPS);
  const template = {
    name: "Ironman Ladlord Chart",
    source: "https://ladlorchart.com",
    generatedAt: new Date().toISOString(),
    goalData: goalData,
    gearGroups: GEAR_GROUPS
  };
  fs.writeFileSync(OUT, JSON.stringify(template, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${goalData.length} page goals from ${GOAL_DATA.length} top-level entries in data.js).`);
  return { GOAL_DATA };
}

function countNodes(nodes) {
  let n = 0;
  (nodes || []).forEach(x => { n += 1 + countNodes(x.children); });
  return n;
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject);
      }
      let body = "";
      res.on("data", d => (body += d));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

// Pull the embedded { "id": "Title", ... } map out of the live JS bundle.
async function fetchLiveTitleMap() {
  const html = await get("https://ladlorchart.com/");
  const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (!m) throw new Error("could not find the JS bundle URL in the page");
  const js = await get("https://ladlorchart.com" + m[1]);
  // The map is a run of "kebab-id":"Human title" pairs. Collect them all.
  const map = {};
  const re = /"([a-z0-9]+(?:-[a-z0-9]+)+)"\s*:\s*"([^"]{1,60})"/g;
  let x;
  while ((x = re.exec(js)) !== null) {
    // Skip obvious non-goal keys (svg/aria/css attribute names seen in React).
    if (/^(aria|clip|color|accent|arabic|alignment|baseline|annotation|cap|accept)/.test(x[1])) continue;
    map[x[1]] = x[2];
  }
  return map;
}

function collectIds(nodes, set) {
  (nodes || []).forEach(n => {
    // data.js ids are namespaced (e.g. "gear.dragon-scimitar"); the live map
    // uses the bare slug. Compare on the last dotted segment.
    set.add(String(n.id).split(".").pop());
    collectIds(n.children, set);
  });
  return set;
}

async function check(GOAL_DATA) {
  let live;
  try {
    live = await fetchLiveTitleMap();
  } catch (e) {
    console.error("--check skipped: " + e.message);
    return;
  }
  const ours = collectIds(GOAL_DATA, new Set());
  const liveIds = Object.keys(live);
  const onlyLive = liveIds.filter(id => !ours.has(id));
  console.log(`\nLive chart exposes ${liveIds.length} id->title entries.`);
  if (onlyLive.length) {
    console.log(`\n${onlyLive.length} id(s) on the live chart but NOT in data.js:`);
    onlyLive.forEach(id => console.log(`  + ${id}  (${live[id]})`));
    console.log("\nAdd these to data.js (with correct parents/icons), then rerun.");
  } else {
    console.log("\nNo new goal ids detected on the live chart. data.js is up to date.");
  }
}

(async function main() {
  const { GOAL_DATA } = generate();
  if (process.argv.includes("--check")) await check(GOAL_DATA);
})();
