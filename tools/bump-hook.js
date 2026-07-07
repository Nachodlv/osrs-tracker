#!/usr/bin/env node
// PostToolUse hook: bump the index.html cache-buster after an asset changes.
//
// Wired into .claude/settings.json for Edit/Write/MultiEdit. Reads the hook
// payload on stdin, and bumps ?v=N (via the same logic as bump-version.js) only
// when the edited file is one actually referenced with ?v= in index.html
// (style.css, app.js, data.js, ...). Edits to tests, tools, docs, or index.html
// itself are ignored, so the version tracks real asset changes and nothing else.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function referencedAssets() {
  const html = fs.readFileSync(INDEX, "utf8");
  const re = /(?:href|src)="([^"?]+)\?v=\d+"/g;
  const names = new Set();
  let m;
  while ((m = re.exec(html)) !== null) names.add(path.basename(m[1]));
  return names;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0); // malformed payload: do nothing
  }

  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const base = path.basename(filePath);
  if (base === "index.html") process.exit(0);
  if (!referencedAssets().has(base)) process.exit(0);

  const out = execFileSync(process.execPath, [path.join(__dirname, "bump-version.js")], {
    encoding: "utf8",
  });
  process.stderr.write(out); // surfaced to the user as hook feedback
}

main();
