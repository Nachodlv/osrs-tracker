// Dependency-free headless-Chrome renderer (developer tool helper).
//
// ladlorchart.com is a client-rendered React SPA: its served HTML is an empty
// shell, so the tier-group layout (`.node-group` columns) only exists in the
// DOM after the bundle runs. To read groups we must render the page. Rather than
// pull in Playwright/Puppeteer (this repo is deliberately dependency-free), we
// drive an already-installed Chrome over the DevTools Protocol using only Node
// built-ins: child_process to launch it, and the global `fetch`/`WebSocket`
// (Node 22+) to speak CDP. Nothing here runs unless a caller invokes it, so the
// browserless crawl paths (--check/--ci) never need Chrome.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Locate a Chrome/Chromium binary. Honours an explicit env override first
// (CHROME_PATH is what the crawl workflow sets), then the usual per-OS spots.
function findChrome() {
  const envPath = process.env.CHROME_PATH || process.env.CHROME_BIN ||
    process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [];
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pfx = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const la = process.env["LOCALAPPDATA"] || "";
    candidates.push(
      path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pfx, "Google\\Chrome\\Application\\chrome.exe"),
      la && path.join(la, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(pfx, "Microsoft\\Edge\\Application\\msedge.exe")
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"
    );
  }
  const found = candidates.filter(Boolean).find(p => fs.existsSync(p));
  if (found) return found;
  throw new Error(
    "no Chrome/Chromium found; set CHROME_PATH to a Chrome executable"
  );
}

// Launch headless Chrome, load `url`, wait for it to render, evaluate
// `expression` in the page and return its (JSON-serialisable) value.
async function renderAndEval(url, expression, opts = {}) {
  const { waitMs = 2500, timeoutMs = 30000, chromePath } = opts;
  const exe = chromePath || findChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ladlor-render-"));
  const child = spawn(exe, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--remote-debugging-port=0",
    "--user-data-dir=" + userDataDir, "about:blank"
  ], { stdio: ["ignore", "ignore", "ignore"] });

  try {
    // Chrome writes the chosen port to DevToolsActivePort once it is listening.
    const portFile = path.join(userDataDir, "DevToolsActivePort");
    const deadline = Date.now() + timeoutMs;
    let port;
    while (Date.now() < deadline) {
      if (fs.existsSync(portFile)) {
        const line = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
        if (line) { port = line; break; }
      }
      await sleep(100);
    }
    if (!port) throw new Error("Chrome did not expose a debugging port in time");

    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    const page = targets.find(t => t.type === "page");
    if (!page) throw new Error("no page target to attach to");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("CDP socket error")); });

    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    const send = (method, params) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await send("Page.enable");
    await send("Page.navigate", { url });
    await sleep(waitMs);
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true
    });
    ws.close();
    if (exceptionDetails) throw new Error("page eval failed: " + exceptionDetails.text);
    return result.value;
  } finally {
    child.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { findChrome, renderAndEval };
