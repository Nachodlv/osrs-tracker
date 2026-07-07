#!/usr/bin/env node
// Cache-buster bumper (developer tool).
//
// index.html references js/css assets with a ?v=N query string. Every change to
// those files needs N bumped so browsers refetch instead of serving a stale
// cache. This script rewrites every ?v=N in index.html to the same next number
// (max existing N + 1), keeping all references in lockstep.
//
//   node tools/bump-version.js          # bump all ?v=N in index.html
//   node tools/bump-version.js --check  # print current version, change nothing
//
// Exit code 0 on success (or --check), 1 if no ?v=N markers were found.

const fs = require("fs");
const path = require("path");

const INDEX = path.join(__dirname, "..", "index.html");
const RE = /\?v=(\d+)/g;

function main() {
  const check = process.argv.includes("--check");
  const html = fs.readFileSync(INDEX, "utf8");

  const versions = [];
  let m;
  while ((m = RE.exec(html)) !== null) versions.push(Number(m[1]));

  if (versions.length === 0) {
    console.error("bump-version: no ?v=N markers found in index.html");
    process.exit(1);
  }

  const current = Math.max(...versions);
  if (check) {
    console.log(`bump-version: current ?v=${current} (${versions.length} references)`);
    return;
  }

  const next = current + 1;
  const updated = html.replace(RE, `?v=${next}`);
  fs.writeFileSync(INDEX, updated);
  console.log(`bump-version: ?v=${current} -> ?v=${next} (${versions.length} references)`);
}

main();
