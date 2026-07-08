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

// Render ladlorchart.com and return its tier columns as arrays of members plus
// every rendered node id. Each milestone is a `.node` whose `id` attribute is
// the bare slug (e.g. "69-slayer" or "climbing-boots"); reading the id covers
// level-requirement nodes too (they have no <img>, only a number span).
// `data-wiki-url` and the child <img> give the link and icon, so a member
// carries everything a flat data.js goal needs. `rendered` is the id of every
// `.node` on the page (not just those in a tier column), so a caller can tell a
// real goal from a stale entry in the bundle's id->title dictionary.
async function fetchLiveGroups() {
  const expression = `(() => ({
    groups: Array.from(document.querySelectorAll('.node-group'))
      .map(g => Array.from(g.querySelectorAll('.node'))
        .filter(n => n.id)
        .map(n => ({
          id: n.id,
          title: (n.getAttribute('title') || n.id),
          wiki: (n.getAttribute('data-wiki-url') || ''),
          icon: ((n.querySelector('img') || {}).src || '')
        })))
      .filter(g => g.length),
    rendered: Array.from(document.querySelectorAll('.node[id]')).map(n => n.id)
  }))()`;
  const res = await renderAndEval("https://ladlorchart.com/", expression);
  if (!res || !Array.isArray(res.groups) || !res.groups.length) {
    throw new Error("rendered page exposed no .node-group columns");
  }
  return res;
}

// A classified live member ({ slug, title, wiki, icon, canon }) mapped to what a
// data.js goal needs. type mirrors data.js: skill-level requirements
// ("69-slayer") are "skill", the rest of the tier gear is "other". icon is the
// wiki image filename (data.js stores just the basename), link is the full wiki
// url.
function goalFromMember(m) {
  const slug = m.slug;
  return {
    id: "gear." + slug,
    title: m.title,
    type: /^\d+-/.test(slug) ? "skill" : "other",
    icon: m.icon ? decodeURIComponent(m.icon.split("/").pop()) : "",
    link: m.wiki
  };
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
  const { idMap, liveGroups, dataGroups, driftLines, plan } = res;
  console.log(`Rendered ${liveGroups.length} tier groups from ladlorchart.com; ` +
    `GEAR_GROUPS has ${dataGroups.length}.`);
  if (driftLines.length) {
    console.log("\nGroup drift vs data.js GEAR_GROUPS:\n" + driftLines.join("\n"));
  } else {
    console.log("\nNo group drift. GEAR_GROUPS matches the live chart.");
  }
  if (plan.goals.length) {
    console.log(`\nWould auto-add ${plan.goals.length} new goal(s) (--ci writes these to data.js):`);
    plan.goals.forEach(g => console.log(`  ${g.id}  (${g.title}, ${g.type})`));
  }
  if (plan.reviewLines.length) {
    console.log("\nNeeds manual review (not auto-added):\n  " + plan.reviewLines.join("\n  "));
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
// { idMap, liveGroups, dataGroups, driftLines, plan, renderedCanon } or null if
// the render failed, so callers (the CLI and --ci) can degrade gracefully.
// driftLines is a human-readable diff; plan splits the new members into ones safe
// to auto-wire and ones a human must review; renderedCanon is the canonId of
// every node actually on the page (used to drop stale title-dict ids).
//
// Safety (renames must never be auto-added, or a saved profile silently loses
// that goal for lack of an ID_MIGRATIONS entry): a new member is only auto-added
// when it is purely additive, i.e. it joins an existing tier that lost no member,
// or forms a brand-new tier while nothing disappeared anywhere on the page. A new
// member sharing a tier with a removed id, or appearing while some group went
// missing, is treated as a possible rename/restructure and left for review.
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
  const liveGroups = raw.groups.map(g => g.map(m => ({
    slug: m.id, title: m.title, wiki: m.wiki, icon: m.icon, canon: canonId(m.id)
  })));
  const renderedCanon = new Set((raw.rendered || []).map(canonId));
  const dataGroups = (GEAR_GROUPS || []).map(ids => ({ ids, canon: ids.map(canonId) }));
  const { driftLines, plan } = classifyGroups(idMap, liveGroups, dataGroups);
  return { idMap, liveGroups, dataGroups, driftLines, plan, renderedCanon };
}

// Pure classification (no browser/network): given the idMap and the live/data
// tier groups, produce a human-readable driftLines diff and a plan splitting new
// members into auto-add vs review. Exported for tests.
function classifyGroups(idMap, liveGroups, dataGroups) {
  const { pairs, orphanData } = pairGroups(liveGroups, dataGroups);
  const known = m => idMap.has(m.canon);
  const label = m => idMap.get(m.canon) || `${m.title} (new)`;
  const anyGone = orphanData.length > 0 ||
    pairs.some(({ live, data }) => data &&
      data.canon.some(c => !new Set(live.map(x => x.canon)).has(c)));

  // For a new tier, remember the next existing tier in live order (its first id)
  // so applyNewGoals can insert the new tier at its live position instead of at
  // the end; null means nothing existing follows, so append.
  const nextExistingAnchor = [];
  let follow = null;
  for (let i = pairs.length - 1; i >= 0; i--) {
    nextExistingAnchor[i] = follow;
    if (pairs[i].data) follow = pairs[i].data.ids[0];
  }

  const driftLines = [];
  const plan = { goals: [], tierAppends: [], newTiers: [], reviewLines: [] };
  pairs.forEach(({ live, data }, i) => {
    if (!data) {
      driftLines.push(`  + new group on page: [${live.map(label).join(", ")}]`);
      const unknown = live.filter(m => !known(m));
      // A wholly-new tier is only safe to auto-add when it is all-new members and
      // nothing went missing elsewhere (else it may be a moved/renamed group).
      if (!anyGone && unknown.length === live.length && unknown.every(m => m.wiki && m.icon)) {
        unknown.forEach(m => plan.goals.push(goalFromMember(m)));
        plan.newTiers.push({ ids: unknown.map(m => "gear." + m.slug), before: nextExistingAnchor[i] });
      } else {
        plan.reviewLines.push(`new group [${live.map(label).join(", ")}] (needs review: possible move/rename or partly known)`);
      }
      return;
    }
    const liveSet = new Set(live.map(m => m.canon));
    const removed = data.ids.filter((_, i) => !liveSet.has(data.canon[i]));
    const newcomers = live.filter(m => !known(m));
    if (newcomers.length || removed.length) {
      driftLines.push(`  ~ group [${data.ids.join(", ")}]`);
      newcomers.forEach(m => driftLines.push(`      + ${label(m)}`));
      removed.forEach(id => driftLines.push(`      - ${id}`));
    }
    if (newcomers.length && !removed.length && newcomers.every(m => m.wiki && m.icon)) {
      newcomers.forEach(m => plan.goals.push(goalFromMember(m)));
      plan.tierAppends.push({ anchor: data.ids[0], ids: newcomers.map(m => "gear." + m.slug) });
    } else if (newcomers.length) {
      plan.reviewLines.push(`tier [${data.ids.join(", ")}]: new ${newcomers.map(m => m.title).join(", ")}` +
        (removed.length ? ` alongside removed ${removed.join(", ")} (possible rename)` : " (incomplete data)"));
    }
    if (removed.length && !newcomers.length) {
      plan.reviewLines.push(`tier [${data.ids.join(", ")}]: removed ${removed.join(", ")} (gone from page)`);
    }
  });
  orphanData.forEach(d => {
    driftLines.push(`  - group gone from page: [${d.ids.join(", ")}]`);
    plan.reviewLines.push(`group gone from page: [${d.ids.join(", ")}]`);
  });
  return { driftLines, plan };
}

// The live JS bundle keeps an id->title dictionary that still lists goals the
// site has since removed (retired gear, cut challenges), so an id can be "on the
// live chart" per that map yet render in no node. Given the rendered DOM, split
// the title-map ids missing from data.js into ones actually on the page (real
// drift to wire in) and stale dictionary leftovers to ignore. groupedCanon and
// renderedCanon are canonId sets from the render (groupedCanon is a subset of
// renderedCanon, so grouped ids are dropped here and handled by the group logic).
// Exported for tests.
function splitStaleIds(onlyLive, groupedCanon, renderedCanon) {
  const ungrouped = onlyLive.filter(g => !groupedCanon.has(canonId(g.id)));
  return {
    fresh: ungrouped.filter(g => renderedCanon.has(canonId(g.id))),
    stale: ungrouped.filter(g => !renderedCanon.has(canonId(g.id)))
  };
}

// A single flat gear goal, formatted like the existing one-line gear.* entries
// at the tail of GOAL_DATA in data.js.
function goalEntryLine(g) {
  const esc = s => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `  { id: "${esc(g.id)}", title: "${esc(g.title)}", type: "${esc(g.type)}", ` +
    `icon: "${esc(g.icon)}", link: "${esc(g.link)}", children: [] }`;
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Write an auto-add plan into data.js by targeted text insertion: append the new
// goal objects to the tail of GOAL_DATA, add each new member id to its existing
// tier (matched by the tier's first id), and append any brand-new tiers. The
// GEAR_GROUPS block is edited in isolation so a tier-anchor id can never collide
// with the same id used elsewhere in the file. Returns the number of goals
// added. Idempotent enough for CI: a rerun with the goals already present is a
// no-op only if the plan is empty, so callers pass a freshly computed plan.
function applyNewGoals(plan, dataPath = path.join(ROOT, "data.js")) {
  if (!plan.goals.length && !plan.tierAppends.length && !plan.newTiers.length) return 0;
  let src = fs.readFileSync(dataPath, "utf8");

  const seen = new Set();
  const goals = plan.goals.filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)));

  // 1. GOAL_DATA entries, before its closing "];". A trailing comma before the
  //    bracket is valid JS, so we need not touch the previous last entry.
  const gStart = src.indexOf("var GOAL_DATA");
  const gEnd = src.indexOf("\n];", gStart);
  if (gStart < 0 || gEnd < 0) throw new Error("could not locate GOAL_DATA bounds in data.js");
  if (goals.length) {
    src = src.slice(0, gEnd) + ",\n" + goals.map(goalEntryLine).join(",\n") + src.slice(gEnd);
  }

  // 2 + 3. GEAR_GROUPS edits, isolated to its own array literal.
  const grpStart = src.indexOf("var GEAR_GROUPS");
  const grpEnd = src.indexOf("\n];", grpStart);
  if (grpStart < 0 || grpEnd < 0) throw new Error("could not locate GEAR_GROUPS bounds in data.js");
  let block = src.slice(grpStart, grpEnd);
  plan.tierAppends.forEach(({ anchor, ids }) => {
    const add = ids.map(id => `, "${id}"`).join("");
    const re = new RegExp(`(\\[[^\\[\\]\\n]*"${escapeReg(anchor)}"[^\\[\\]\\n]*)\\]`);
    if (!re.test(block)) throw new Error(`could not find tier for anchor ${anchor} in GEAR_GROUPS`);
    block = block.replace(re, `$1${add}]`);
  });
  // New tiers: insert each before its live-position anchor tier (processed in
  // live order so runs of new tiers keep their order); those with no following
  // existing tier (before === null) are appended after the last tier.
  const tierLine = ids => "  [" + ids.map(id => `"${id}"`).join(", ") + "]";
  let tail = "";
  plan.newTiers.forEach(({ ids, before }) => {
    if (!before) { tail += ",\n" + tierLine(ids); return; }
    const re = new RegExp(`(\\n)(\\s*\\[[^\\[\\]\\n]*"${escapeReg(before)}"[^\\[\\]\\n]*\\])`);
    if (!re.test(block)) throw new Error(`could not find tier for anchor ${before} in GEAR_GROUPS`);
    block = block.replace(re, `$1${tierLine(ids)},$2`);
  });
  src = src.slice(0, grpStart) + block + tail + src.slice(grpEnd);

  fs.writeFileSync(dataPath, src);
  return goals.length;
}

// Append key=value to $GITHUB_OUTPUT so the workflow can branch on the result.
function setOutput(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) fs.appendFileSync(f, `${key}=${value}\n`);
}

// CI mode: regenerate the JSON, crawl the live chart, and if it has drifted bump
// the template version so the update banner fires. Purely additive tier-group
// changes (new gear in a tier, or a whole new all-new tier) are auto-wired into
// data.js with icons/links from the rendered chart; renames, removals, and
// ambiguous regroupings are never auto-applied (a wrong rename would skip an
// ID_MIGRATIONS entry and lose saved progress) and are listed for review, as are
// new ids that are not in a tier group. Writes a drift report to $DRIFT_REPORT
// (or drift-report.md) for the PR body and emits `changed`/`newVersion` GitHub
// outputs. Group handling is best-effort: it renders the SPA via a local Chrome,
// and if that is unavailable the run falls back to id drift only.
async function ci() {
  const { GOAL_DATA } = generate();
  const result = await check(GOAL_DATA);
  if (!result) {
    setOutput("changed", "false");
    process.exitCode = 1; // live fetch failed; surface it in the workflow.
    return;
  }
  const groupRes = await computeGroupDrift(); // best-effort; null if render failed
  if (!groupRes) {
    console.error("group drift check skipped (render failed); proceeding with id drift only.");
  }
  const plan = groupRes ? groupRes.plan : { goals: [], tierAppends: [], newTiers: [], reviewLines: [] };
  const groupDrift = groupRes ? groupRes.driftLines : [];

  // Grouped nodes are handled below (auto-add or review); keep only the other new
  // ids the bundle exposes so they are not reported twice.
  const groupedCanon = new Set();
  if (groupRes) groupRes.liveGroups.forEach(g => g.forEach(m => groupedCanon.add(m.canon)));
  // When the render succeeded, drop title-dict ids that render in no node on the
  // page: they are stale dictionary leftovers for removed goals, not real drift.
  // If the render failed we cannot verify, so report every ungrouped new id.
  let idDriftOther;
  if (groupRes) {
    const { fresh, stale } = splitStaleIds(result.onlyLive, groupedCanon, groupRes.renderedCanon);
    idDriftOther = fresh;
    if (stale.length) {
      console.log(`\nIgnored ${stale.length} stale title-dict id(s) not rendered on the live page:`);
      stale.forEach(g => console.log(`  - ${g.id} (${g.title})`));
    }
  } else {
    idDriftOther = result.onlyLive.filter(g => !groupedCanon.has(canonId(g.id)));
  }

  const reportPath = process.env.DRIFT_REPORT || path.join(ROOT, "drift-report.md");
  if (!idDriftOther.length && !groupDrift.length) {
    // No real change: discard the timestamp-only churn in the regenerated JSON.
    setOutput("changed", "false");
    console.log("\nNo template drift. Nothing to update.");
    return;
  }

  // Wire the safe, purely-additive goals into data.js before regenerating.
  const added = groupRes ? applyNewGoals(plan) : 0;

  const newVersion = bumpLadlorVersion();
  // Re-emit the JSON so it reflects the added goals and matches templates.js.
  generate();
  const lines = [
    "The Ladlord chart crawl found drift between the live site and `data.js`,",
    "so the built-in Ladlord template drifted.",
    "",
    `Bumped the template version to **${newVersion}** (profiles pinned to an`,
    "older version will see the update banner).",
    ""
  ];
  if (added) {
    lines.push(
      `### Auto-added ${added} new goal(s) to \`data.js\``,
      "",
      ...plan.goals.map(g => `- \`${g.id}\`: ${g.title} (${g.type})`),
      "",
      "Purely additive, so the crawl wired them in with icons/links from the live",
      "chart and regenerated the template. Review the placement before merging.",
      ""
    );
  }
  if (plan.reviewLines.length) {
    lines.push(
      "### Needs manual review",
      "",
      "Renames, removals, and ambiguous regroupings are not auto-applied (a wrong",
      "rename would skip an `ID_MIGRATIONS` entry and lose saved progress):",
      "",
      "```",
      ...plan.reviewLines,
      "```",
      ""
    );
  }
  if (idDriftOther.length) {
    lines.push(
      `### ${idDriftOther.length} other new id(s) on the live chart`,
      "",
      ...idDriftOther.map(g => `- \`${g.id}\`: ${g.title}`),
      "",
      "Not in a tier group, so wire these into `data.js` by hand.",
      ""
    );
  }
  lines.push(
    "After any manual edits, rerun `node tools/crawl-ladlor.js` to regenerate",
    "`templates/ladlor.json`.",
    ""
  );
  fs.writeFileSync(reportPath, lines.join("\n"));
  setOutput("changed", "true");
  setOutput("newVersion", String(newVersion));
  console.log(`\nBumped ladlor template version to ${newVersion}` +
    (added ? `, auto-added ${added} goal(s)` : "") +
    `; wrote ${path.relative(ROOT, reportPath)}.`);
}

// Exported for tests (test-crawl.js). The pure pieces, plan classification via
// classifyGroups and the data.js writer applyNewGoals, run without a browser.
module.exports = { classifyGroups, applyNewGoals, goalFromMember, canonId, pairGroups, splitStaleIds };

if (require.main === module) {
  (async function main() {
    if (process.argv.includes("--ci")) return ci();
    if (process.argv.includes("--groups")) return void await groups(process.argv.includes("--emit"));
    const { GOAL_DATA } = generate();
    if (process.argv.includes("--check")) await check(GOAL_DATA);
  })();
}
