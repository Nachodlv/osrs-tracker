#!/usr/bin/env node
// Stop hook: once a turn's edits have settled, bump index.html's cache-buster a
// single time and run the test suites affected by what changed.
//
// Wired into .claude/settings.json as a Stop hook, so it fires once when the
// turn ends rather than after every edit; a change touching several files bumps
// the version only once. A referenced asset counts as "changed" when its mtime
// is newer than index.html. Bumping rewrites index.html (making it the newest
// file), so the check self-resets and a later turn with no edits does nothing.
//
// Exit codes: 0 when nothing changed or everything passed; 2 when a triggered
// test suite fails, so the failure output is fed back instead of silently
// stopping. The bump still happens (a cache-buster bump is always safe); only
// the test result gates.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");

// changed asset basename -> test suites to run
const TEST_TRIGGERS = {
  "app.js": ["test-app.js"],
  "state.js": ["test-app.js"],
  "graph.js": ["test-app.js"],
  "render.js": ["test-app.js"],
  "dragdrop.js": ["test-app.js"],
  "edges-menu.js": ["test-app.js"],
  "modals.js": ["test-app.js"],
  "profiles-ui.js": ["test-app.js"],
  "templates-ui.js": ["test-app.js"],
  "sync.js": ["test-app.js"],
  "templates.js": ["test-app.js"],
  "data.js": ["test-app.js", "test-migration.js", "test-crawl.js"],
  "migration.js": ["test-app.js", "test-migration.js"],
};

function referencedAssets() {
  const html = fs.readFileSync(INDEX, "utf8");
  const re = /(?:href|src)="([^"?]+)\?v=\d+"/g;
  const names = new Set();
  let m;
  while ((m = re.exec(html)) !== null) names.add(path.basename(m[1]));
  return names;
}

function main() {
  const indexMtime = fs.statSync(INDEX).mtimeMs;
  const changed = [];
  for (const name of referencedAssets()) {
    try {
      if (fs.statSync(path.join(ROOT, name)).mtimeMs > indexMtime) changed.push(name);
    } catch {}
  }
  if (changed.length === 0) return; // no asset edited this turn

  // Bump once for the whole batch.
  const out = execFileSync(process.execPath, [path.join(__dirname, "bump-version.js")], {
    encoding: "utf8",
  });
  process.stderr.write(out);

  // Run the deduped set of suites triggered by the changed files.
  const suites = new Set();
  for (const name of changed) for (const t of TEST_TRIGGERS[name] || []) suites.add(t);

  let failed = false;
  for (const suite of suites) {
    try {
      execFileSync(process.execPath, [suite], { cwd: ROOT, encoding: "utf8" });
      process.stderr.write(`stop-hook: ${suite} passed\n`);
    } catch (e) {
      failed = true;
      process.stderr.write(`stop-hook: ${suite} FAILED\n${e.stdout || ""}${e.stderr || ""}`);
    }
  }
  if (failed) process.exit(2);
}

main();
