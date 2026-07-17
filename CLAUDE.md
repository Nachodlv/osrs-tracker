# CLAUDE.md, Iron Tracker

OSRS ironman goal tracker (based on ladlorchart.com). Vanilla JS/HTML/CSS, no build step, no dependencies. Progress lives in browser localStorage, one key per profile.

Deep architecture and full environment gotchas live in `docs/ARCHITECTURE.md`. Read that file before touching layout, edge-retargeting, drag & drop, or export/import, or when you hit a tooling error not covered below. CI and scheduled workflows (tests, Ladlord chart crawl, on-demand `@claude`) are documented in `docs/AUTOMATION.md`.

## Files

- `index.html` , single page; modals for add/edit goal, profiles, reset. Script/CSS tags carry a `?v=N` cache-buster.
- App logic is split across several plain-`<script>` files (no modules/bundler). They share one global scope, so every top-level `function`/`var`/`let`/`const` is visible across files: there are no exports/imports, and load ORDER is the only constraint (each file's load-time code runs when it loads; the bootstrap must be last). index.html loads them in this order (after data/templates), and `test-app.js` loads the same list into one vm context:
  - `state.js` , storage keys, profiles CRUD, the `state`/`profilesMeta` globals, `defaultState`/`loadState`/`saveState`, toast, undo (`withUndo`). Runs `ensureProfileTemplates()`/`applyProfileTemplate()` at load, so it must load first.
  - `graph.js` , pure graph/data logic (no DOM): `effectiveId`/`uid`/`getEffectiveTree`, graph build (DAG keyed by `effectiveId`: `buildGraph`, `pruneRemoved`, `computeColumns`/`computeRows`, `computeVisibility`), status model (`computeStatus`/`progressOf`), and icon helpers (`renderIcon`, `fetchWikiInfo`, `debounce`). This is the bulk of what `test-app.js` exercises.
  - `render.js` , DOM element consts + graph rendering: `getGraph`, `render`/`renderUnsafe`, `renderGraphNode`, collapse/expand, `markDone`.
  - `dragdrop.js` , tier groups and all drag & drop (root/group/child/column reorder, `moveNode`).
  - `edges-menu.js` , edge retargeting (`reparentNode`, `detachEdge`, `addToLinkedEdges`) and the right-click context menu.
  - `modals.js` , the add/edit goal modal (both flows) plus the filter/search toolbar and reset-all modal.
  - `profiles-ui.js` , profile select/new/rename/delete UI and profile export/import.
  - `templates-ui.js` , template-update banner/diff/reconcile and the template-management modal.
  - `sync.js` , hiscores sync and bank-memory sync.
  - `app.js` , tiny bootstrap only: global error handlers + the initial `refreshProfileSelect(); render();`. Must load last.
- `data.js` , static goal tree (`GOAL_DATA`), tier groupings (`GEAR_GROUPS`), skill/quest icon+link resolution helpers. Node ids must stay stable (see Migrations).
- `templates.js` , new-profile template registry (`Templates.listTemplates/applyTemplate/addUserTemplate/removeUserTemplate`). `applyTemplate` reassigns the global `GOAL_DATA`/`GEAR_GROUPS` (hence they are `var`, not `const`) before a profile's state is built. Built-in picker templates: "empty" and "ladlor" (only the tier-group gear shown on ladlorchart.com). "__full__" is an internal, unlisted template holding the complete data.js tree; `ensureProfileTemplates` (state.js) pins every pre-existing (template-less) profile with a saved state to "__full__" so trimming "ladlor" never changes what an old profile renders (brand-new profiles get "ladlor"). New profiles start with `removed = {}` (templates already contain exactly what should show; there is no default-hide step). User templates load from localStorage `iron-tracker:templates`. Import/export JSON is `{ name, goalData, gearGroups }`, no `id` (ids are internal; import always mints a new one, so it never overwrites). `tools/crawl-ladlor.js` regenerates `templates/ladlor.json` (the trimmed page goals) from data.js (dev-only); its `--groups` mode renders the live chart (via `tools/render-chrome.js`, a dependency-free headless-Chrome/CDP helper) and diffs the tier columns against `GEAR_GROUPS`. In `--ci` the crawl auto-wires purely-additive new goals into data.js (flat `gear.*` entries + `GEAR_GROUPS` slot, fields from the rendered node) but never renames/removals/migrations (those go to the drift report for review). Its pure logic is covered by `test-crawl.js`.
- `migration.js` , pure save-data migration (`ID_MIGRATIONS`, `migrateStateData`). No DOM/localStorage; loadable as `<script>` and via `require()`.
- `test-migration.js` , Node test runner for migration logic.
- `test-app.js` , Node test runner for app graph/state logic (vm + DOM stub; covers `getGraph`, `computeVisibility`, `addLinkedChild`, `reparentNode`, tier-group visibility).
- `test-crawl.js` , Node test runner for the crawl tool's pure logic (`classifyGroups` auto-add/review split, `applyNewGoals` data.js writer). No browser/network.
- `server.py` , static server + `/api/hiscores` proxy (hiscores has no CORS headers). Hiscores sync only works through this, not a plain static server.

## Data model glossary (read this before opening data.js)

Most graph/data questions can be answered from here without reading `data.js` (it is the largest file and every node is dense with title/icon/link). Open `data.js` only for exact ids, icons, or links.

- `GOAL_DATA` has two kinds of top-level entry: (a) goals with nested `children` (sub-goal trees, e.g. `herb-run`, `piety`), and (b) a flat `gear.*` section (the "rest of Ladlor's chart") of parentless items with mostly empty `children`.
- Grouped = an id listed in `GEAR_GROUPS` (all such ids are top-level goals). Ungrouped = a top-level goal not in any group. Sub-goal = any node reachable via `children` (at any depth). A few grouped members (e.g. `spirit-tree`, `mixed-hide-boots`) do carry sub-goals.
- Hide a node for a profile by setting `state.removed[id] = true`; `pruneRemoved` deletes it and cascades to now-parentless descendants. `removed` is keyed by plain node id. New saves start from `defaultState()` with `removed = {}` (the active template already contains exactly what should show); existing saves load their own stored `removed`, so they are untouched.

## Key state fields

- **`state.rootGoals`** ({id:true}): built-in goals detached from every parent are promoted here so they survive `pruneRemoved` as standalone top-level goals (custom nodes do this via `parentId:null`). Defaulted, remapped in `migrateStateData`, tested.
- **`state.groupsState`** ({groupOrder, groups}): tier groups, seeded from `GEAR_GROUPS` on first render then user-editable. A group member renders in its group box whenever it is visible (see `computeVisibility`'s `rootLike` arg), even if it also has a parent, so a grouped goal linked as a child shows in both places.
- **Hiscores**: `hiscoresEndpoint()` uses server.py's `/api/hiscores` on localhost, else the Cloudflare Worker `https://osrs-hiscores.nachodelavega97.workers.dev` (code in `cloudflare-worker/`, `ALLOW_ORIGIN` currently `*`). So the app can run as a static site (e.g. GitHub Pages) without server.py; only hiscores needs the proxy.

## Rules

### Migrations (critical, never lose saved progress)
- Any rename/restructure of a built-in goal id in `data.js` MUST get an entry in `ID_MIGRATIONS` in `migration.js`. Saved profiles (e.g. the user's TuuxSolo profile) must migrate losslessly.
- Any NEW field added to the state shape must: (1) default safely in `defaultState()` and `loadState()` in state.js, (2) be remapped in `migrateStateData()` if it contains node ids (see `linkedEdges`/`removedEdges` handling), (3) get a test in `test-migration.js`.
- Migration must stay idempotent (safe to run on every load, there is an eager migration pass over all profiles at startup).

### Tests
- Run `node test-migration.js` after ANY change to data ids, state shape, or migration logic, `node test-app.js` after changes to graph/state/render logic, and `node test-crawl.js` after changes to `tools/crawl-ladlor.js` or the data.js goal/group format. All tests must pass before finishing. A project Stop hook (`tools/stop-hook.js`) also runs the affected suite(s) automatically at end of turn (test-app for app/data/templates, migration + crawl also for data, migration for migration) and blocks with the output if one fails, but keep running them yourself while iterating.
- Prefer adding a case to `test-app.js` over `preview_eval` for graph/state/layout bugs. Its harness runs assertions inside the vm context via `vm.runInContext` (top-level `let`/`const` like `state` are not reachable as context props, but `function` declarations like `getGraph`, `reparentNode`, `computeVisibility` are). Test custom goals use type `"quest"` to stay deterministic (no network fetch). CSS and real pixel rendering still need the preview tools.
- When testing in the browser: create a NEW profile. Never test against the TuuxSolo profile, it holds real progress.
- For ad-hoc state/graph probes, add a temporary case to `test-app.js` (reuse its `makeContext`/`inCtx`) and delete it after; do NOT paste a fresh vm + DOM-stub harness inline (that duplicates ~60 lines of boilerplate per probe).
- `templates/ladlor.json` is generated (~1900 lines): never Read it. Regenerate with `node tools/crawl-ladlor.js` and diff if needed.

### Conventions
- Bump the `?v=N` cache-buster in index.html on every change to js/css files (bump all references together; grep `?v=` for the current value). The project Stop hook (`tools/stop-hook.js`, wired in `.claude/settings.json`) bumps automatically once per turn when a referenced asset changed, so a manual bump is usually unnecessary; `node tools/bump-version.js` (or `--check`) remains for CLI/manual use. If you do bump index.html by hand, do it IN THE SAME Edit batch as the change that needs it, never as a separate step: any touch of index.html re-injects the whole ~200-line file into context, so a second touch wastes thousands of tokens.
- Keep it dependency-free vanilla JS; plain `<script>` files sharing one global scope, no ES modules/bundler (see the Files list for the split and load order).
- Comments: brief and functional only. No history/changelog-style comments.
- New user-facing state edits go through `saveState()` + `render()`; `render()` must never leave the page blank (renderUnsafe builds off-screen; the wrapper keeps the last good render on error).
- Every mutating user action is wrapped in `withUndo(label, fn)` (snapshots serialized state, shows a bottom undo toast). New state-changing actions should be wrapped too; nested calls collapse via a re-entrancy guard.
- Output only the modified or requested code block.

### Working style (user preferences)
- User works directly on `master` (repo: github.com/Nachodlv/osrs-tracker). Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Keep commit bodies to one short paragraph.
- Node is not on the shell PATH; in PowerShell prepend it: `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`.
- Local dev server: `.claude/launch.json` config `iron-tracker-server` (python server.py). `state` and other top-level `let`/`const` are NOT on `window`; `function` declarations (`getGraph`, `reparentNode`, `render`) ARE, so use those from `preview_eval`.
- When probing state via `preview_eval` or the harness, return only the booleans/counts/ids you need, never a full node list or all titles (~200 goals; one dump is thousands of tokens). Prefer `.length`, `!!nodes[id]`, `n.parentIds`. Better still, reproduce graph/state bugs in `test-app.js`.
- For graph/data-model questions, use the glossary above before reading `data.js`; open `data.js` only for exact ids/icons/links.

### Tooling gotchas that cause rework (full list in docs/ARCHITECTURE.md)
- **Mounted-folder writes can corrupt** (NUL-pad if shorter, truncate if longer). After edits, verify tails, scan for NUL bytes, and run tests; do not trust `node --check` alone. Prefer shell writes.
- **Background jobs must `EnterWorktree` before the first edit**, or edits to the shared checkout are rejected. Preferred flow is to isolate in a worktree and ship via a draft PR; edit `master` directly only when the user explicitly asks, and confirm before committing to their checkout.
- **Commit messages in the Bash tool**: use `git commit -F -` with a heredoc, never the PowerShell here-string form (Bash leaves a literal at-sign subject).
- **Single-commit patch from a worktree**: use `git diff HEAD~1 HEAD`, not `git diff master HEAD` (the worktree base can differ from the main checkout).
- **preview_* tools are not present in every session** (e.g. background jobs). Do not assume browser preview; say when a visual check was not possible.
