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
//   node tools/crawl-ladlor.js --groups   # render the live chart and diff its
//                                          # tier-group layout against GEAR_GROUPS
//                                          # (add --emit to print a suggested
//                                          # GEAR_GROUPS block). Needs a local
//                                          # Chrome; --check/--ci do not.
//
// ladlorchart.com ships a minified React bundle with an embedded id -> title map
// (but no cleanly extractable edge list), so --check is a drift detector, not a
// full re-crawl. --groups goes further by rendering the SPA (the tier columns
// only exist in the DOM), so it can reconcile GEAR_GROUPS too. Update data.js by
// hand when either flags a change, then rerun this script to regenerate the JSON.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { renderAndEval } = require("./render-chrome");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates", "ladlor.json");
const TEMPLATES_JS = path.join(ROOT, "templates.js");

// Read/bump the built-in "ladlor" template version declared in templates.js.
// The version lives on the DEFAULT_TEMPLATE_ID entry of BUILTIN_TEMPLATES; we
// find the `version: N` that sits between `id: DEFAULT_TEMPLATE_ID` and its
// `goalData:` line and rewrite just that number.
function ladlorVersionBlock(src) {
  const start = src.indexOf("id: DEFAULT_TEMPLATE_ID");
  if (start === -1) throw new Error("could not locate the ladlor template entry in templates.js");
  const rel = src.slice(start).match(/version:\s*(\d+)/);
  if (!rel) throw new Error("could not locate the ladlor template version in templates.js");
  return { index: start + rel.index, match: rel[0], version: parseInt(rel[1], 10) };
}

function readLadlorVersion() {
  return ladlorVersionBlock(fs.readFileSync(TEMPLATES_JS, "utf8")).version;
}

function bumpLadlorVersion() {
  const src = fs.readFileSync(TEMPLATES_JS, "utf8");
  const blk = ladlorVersionBlock(src);
  const next = blk.version + 1;
  const updated = src.slice(0, blk.index) + "version: " + next +
    src.slice(blk.index + blk.match.length);
  fs.writeFileSync(TEMPLATES_JS, updated);
  return next;
}

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
    version: readLadlorVersion(),
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
    // Skip obvious non-goal keys (svg/aria/css attribute names seen in React)
    // and skill-requirement labels like "lvl-92-ranged" (not goals).
    if (/^(aria|clip|color|accent|arabic|alignment|baseline|annotation|cap|accept)/.test(x[1])) continue;
    if (/^lvl-\d/.test(x[1])) continue;
    map[x[1]] = x[2];
  }
  return map;
}

// Canonical comparison key. data.js ids are namespaced (e.g. "gear.osmumten-s-
// fang") while the live map uses the bare slug ("osmumtens-fang"); the two also
// encode possessives differently ("-s-" vs "s"). Strip the namespace and every
// non-alphanumeric char so both collapse to the same key and possessive/hyphen
// differences stop showing up as false drift.
function canonId(id) {
  return String(id).split(".").pop().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function collectIds(nodes, set) {
  (nodes || []).forEach(n => {
    set.add(canonId(n.id));
    collectIds(n.children, set);
  });
  return set;
}

// Returns { liveCount, onlyLive: [{id, title}, ...] } or null if the live fetch
// failed. onlyLive is the set of goal ids on ladlorchart.com missing from data.js.
async function check(GOAL_DATA) {
  let live;
  try {
    live = await fetchLiveTitleMap();
  } catch (e) {
    console.error("--check skipped: " + e.message);
    return null;
  }
  const ours = collectIds(GOAL_DATA, new Set());
  const liveIds = Object.keys(live);
  const onlyLive = liveIds.filter(id => !ours.has(canonId(id))).map(id => ({ id, title: live[id] }));
  console.log(`\nLive chart exposes ${liveIds.length} id->title entries.`);
  if (onlyLive.length) {
    console.log(`\n${onlyLive.length} id(s) on the live chart but NOT in data.js:`);
    onlyLive.forEach(g => console.log(`  + ${g.id}  (${g.title})`));
    console.log("\nAdd these to data.js (with correct parents/icons), then rerun.");
  } else {
    console.log("\nNo new goal ids detected on the live chart. data.js is up to date.");
  }
  return { liveCount: liveIds.length, onlyLive };
}

// Map every data.js node's canonId to its (namespaced) id, so a live member can
// be resolved back to the real data.js id when reporting group drift.
function canonToId(nodes, map) {
  (nodes || []).forEach(n => {
    const c = canonId(n.id);
    if (!map.has(c)) map.set(c, n.id);
    canonToId(n.children, map);
  });
  return map;
}

// Render ladlorchart.com and return its tier columns as arrays of members. Each
// milestone is a `.node` whose `id` attribute is the bare slug (e.g. "69-slayer"
// or "climbing-boots") and whose `title` is the human label; reading the id
// covers level-requirement nodes too (they have no <img>, only a number span).
async function fetchLiveGroups() {
  const expression = `(() => Array.from(document.querySelectorAll('.node-group'))
    .map(g => Array.from(g.querySelectorAll('.node'))
      .filter(n => n.id)
      .map(n => ({ id: n.id, title: (n.getAttribute('title') || n.id) })))
    .filter(g => g.length))()`;
  const groups = await renderAndEval("https://ladlorchart.com/", expression);
  if (!Array.isArray(groups) || !groups.length) {
    throw new Error("rendered page exposed no .node-group columns");
  }
  return groups;
}

// Greedily pair each live group with the data.js group it shares the most
// members with, so the diff is robust to reordering and inserted groups.
function pairGroups(liveGroups, dataGroups) {
  const usedData = new Set();
  const pairs = [];
  liveGroups.forEach(live => {
    const liveSet = new Set(live.map(m => m.canon));
    let best = -1, bestOverlap = 0;
    dataGroups.forEach((d, di) => {
      if (usedData.has(di)) return;
      const overlap = d.canon.filter(c => liveSet.has(c)).length;
      if (overlap > bestOverlap) { bestOverlap = overlap; best = di; }
    });
    if (best >= 0) { usedData.add(best); pairs.push({ live, data: dataGroups[best] }); }
    else pairs.push({ live, data: null });
  });
  const orphanData = dataGroups.filter((_, di) => !usedData.has(di));
  return { pairs, orphanData };
}

// Render the live chart and diff its tier-group layout against GEAR_GROUPS.
// Reports members added/removed/moved per group, groups new on the page, and
// groups gone from it. With --emit, prints a suggested GEAR_GROUPS block (live
// order; members resolved to data.js ids, unknowns marked TODO:<title>).
async function groups(emit) {
  const res = await computeGroupDrift();
  if (!res) return null;
  const { idMap, liveGroups, dataGroups, driftLines } = res;
  console.log(`Rendered ${liveGroups.length} tier groups from ladlorchart.com; ` +
    `GEAR_GROUPS has ${dataGroups.length}.`);
  if (driftLines.length) {
    console.log("\nGroup drift vs data.js GEAR_GROUPS:\n" + driftLines.join("\n"));
  } else {
    console.log("\nNo group drift. GEAR_GROUPS matches the live chart.");
  }
  if (emit) {
    const block = liveGroups.map(g =>
      "  [" + g.map(m => {
        const id = idMap.get(m.canon);
        return id ? `"${id}"` : `"TODO:${m.title}"`;
      }).join(", ") + "]"
    ).join(",\n");
    console.log("\nSuggested GEAR_GROUPS (live order):\nvar GEAR_GROUPS = [\n" + block + "\n];");
  }
  return res;
}

// Render the live chart and compute tier-group drift vs GEAR_GROUPS. Returns
// { idMap, liveGroups, dataGroups, driftLines } or null if the render failed, so
// callers (the CLI and --ci) can degrade gracefully. driftLines is a
// human-readable list of members added/removed and groups that appeared or
// disappeared, robust to reordering (groups are paired by member overlap).
async function computeGroupDrift() {
  const { GOAL_DATA, GEAR_GROUPS } = loadDataJs();
  const idMap = canonToId(GOAL_DATA, new Map());
  let raw;
  try {
    raw = await fetchLiveGroups();
  } catch (e) {
    console.error("group render failed: " + e.message);
    return null;
  }
  const liveGroups = raw.map(g => g.map(m => ({ title: m.title, canon: canonId(m.id) })));
  const dataGroups = (GEAR_GROUPS || []).map(ids => ({ ids, canon: ids.map(canonId) }));

  const { pairs, orphanData } = pairGroups(liveGroups, dataGroups);
  const label = m => idMap.get(m.canon) || `${m.title} (new)`;
  const driftLines = [];
  pairs.forEach(({ live, data }) => {
    if (!data) {
      driftLines.push(`  + new group on page: [${live.map(label).join(", ")}]`);
      return;
    }
    const liveSet = new Set(live.map(m => m.canon));
    const dataSet = new Set(data.canon);
    const added = live.filter(m => !dataSet.has(m.canon));
    const removed = data.ids.filter((_, i) => !liveSet.has(data.canon[i]));
    if (added.length || removed.length) {
      driftLines.push(`  ~ group [${data.ids.join(", ")}]`);
      added.forEach(m => driftLines.push(`      + ${label(m)}`));
      removed.forEach(id => driftLines.push(`      - ${id}`));
    }
  });
  orphanData.forEach(d => driftLines.push(`  - group gone from page: [${d.ids.join(", ")}]`));
  return { idMap, liveGroups, dataGroups, driftLines };
}

// Append key=value to $GITHUB_OUTPUT so the workflow can branch on the result.
function setOutput(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) fs.appendFileSync(f, `${key}=${value}\n`);
}

// CI mode: regenerate the JSON, crawl the live chart, and if it has drifted
// (new goal ids and/or reshuffled tier groups) bump the template version so the
// update banner fires. Writes a human-readable drift report to $DRIFT_REPORT (or
// drift-report.md) for the PR body, and emits `changed`/`newVersion` GitHub
// outputs. It never edits data.js (parents/icons/links and group membership need
// a human); the PR it produces bumps the version + regenerated JSON and lists
// what to wire in. Group drift is best-effort: it renders the SPA via a local
// Chrome, and if that is unavailable the run falls back to id drift only.
async function ci() {
  const { GOAL_DATA } = generate();
  const result = await check(GOAL_DATA);
  if (!result) {
    setOutput("changed", "false");
    process.exitCode = 1; // live fetch failed; surface it in the workflow.
    return;
  }
  const idDrift = result.onlyLive;
  const groupRes = await computeGroupDrift(); // best-effort; null if render failed
  const groupDrift = groupRes ? groupRes.driftLines : [];
  if (!groupRes) {
    console.error("group drift check skipped (render failed); proceeding with id drift only.");
  }

  const reportPath = process.env.DRIFT_REPORT || path.join(ROOT, "drift-report.md");
  if (!idDrift.length && !groupDrift.length) {
    // No real change: discard the timestamp-only churn in the regenerated JSON.
    setOutput("changed", "false");
    console.log("\nNo template drift. Nothing to update.");
    return;
  }
  const newVersion = bumpLadlorVersion();
  // Re-emit the JSON so its embedded version matches the bumped templates.js.
  generate();
  const lines = [
    "The Ladlord chart crawl found drift between the live site and `data.js`,",
    "so the built-in Ladlord template drifted.",
    "",
    `Bumped the template version to **${newVersion}** (profiles pinned to an`,
    "older version will see the update banner).",
    ""
  ];
  if (idDrift.length) {
    lines.push(
      `### ${idDrift.length} id(s) on the live chart but not in data.js`,
      "",
      ...idDrift.map(g => `- \`${g.id}\`: ${g.title}`),
      ""
    );
  }
  if (groupDrift.length) {
    lines.push(
      "### Tier-group drift vs `GEAR_GROUPS`",
      "",
      "```",
      ...groupDrift,
      "```",
      ""
    );
  }
  lines.push(
    "Wire these into `data.js` with the correct parents / icons / links and",
    "`GEAR_GROUPS` tiers, then rerun `node tools/crawl-ladlor.js` to regenerate",
    "`templates/ladlor.json`.",
    ""
  );
  fs.writeFileSync(reportPath, lines.join("\n"));
  setOutput("changed", "true");
  setOutput("newVersion", String(newVersion));
  console.log(`\nBumped ladlor template version to ${newVersion}; wrote ${path.relative(ROOT, reportPath)}.`);
}

(async function main() {
  if (process.argv.includes("--ci")) return ci();
  if (process.argv.includes("--groups")) return void await groups(process.argv.includes("--emit"));
  const { GOAL_DATA } = generate();
  if (process.argv.includes("--check")) await check(GOAL_DATA);
})();
