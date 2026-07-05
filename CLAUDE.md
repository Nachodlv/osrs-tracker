# CLAUDE.md — Iron Tracker

OSRS ironman goal tracker (based on ladlorchart.com). Vanilla JS/HTML/CSS, no build step, no dependencies. Progress lives in browser localStorage, one key per profile.

## Files

- `index.html` — single page; modals for add/edit goal, profiles, reset. Script/CSS tags carry a `?v=N` cache-buster.
- `app.js` — all app logic: profiles, state, graph build (DAG keyed by `effectiveId`), layered layout, rendering, drag & drop (tier groups, child reorder, edge retargeting), context menu, add/edit modal, export/import, hiscores sync.
- `data.js` — static goal tree (`GOAL_DATA`), tier groupings (`GEAR_GROUPS`), skill/quest icon+link resolution helpers. Node ids must stay stable (see Migrations).
- `migration.js` — pure save-data migration (`ID_MIGRATIONS`, `migrateStateData`). No DOM/localStorage; loadable as `<script>` and via `require()`.
- `test-migration.js` — Node test runner for migration logic.
- `server.py` — static server + `/api/hiscores` proxy (hiscores has no CORS headers). Hiscores sync only works through this, not a plain static server.

## Rules

### Migrations (critical — never lose saved progress)
- Any rename/restructure of a built-in goal id in `data.js` MUST get an entry in `ID_MIGRATIONS` in `migration.js`. Saved profiles (e.g. the user's TuuxSolo profile) must migrate losslessly.
- Any NEW field added to the state shape must: (1) default safely in `defaultState()` and `loadState()` in app.js, (2) be remapped in `migrateStateData()` if it contains node ids (see `linkedEdges`/`removedEdges` handling), (3) get a test in `test-migration.js`.
- Migration must stay idempotent (safe to run on every load — there's an eager migration pass over all profiles at startup).

### Tests
- Run `node test-migration.js` after ANY change to data ids, state shape, or migration logic. All tests must pass before finishing.
- App logic can be smoke-tested headlessly: load `migration.js` + `data.js` + `app.js` into a Node `vm` context with a minimal DOM stub (getElementById returning stub elements, localStorage as a Map). Note: top-level `let`/`const` in the scripts are not reachable as properties of the vm context object — run assertion code *inside* the context with `vm.runInContext`.
- When testing in the browser: create a NEW profile for testing. Never test against the TuuxSolo profile — it holds real progress.

### Conventions
- Bump the `?v=N` cache-buster in index.html on every change to js/css files. **Currently at `?v=36`.**
- Keep it dependency-free vanilla JS; single files, no modules/bundler.
- Comments: brief and functional only. No history/changelog-style comments. No em dashes ("—") in comments/commit messages/markdown; use commas/periods.
- New user-facing state edits go through `saveState()` + `render()`; `render()` must never leave the page blank (renderUnsafe builds off-screen; the wrapper keeps the last good render on error).
- Every mutating user action is wrapped in `withUndo(label, fn)` (snapshots serialized state, shows a bottom undo toast). New actions that change state should be wrapped too; nested calls collapse via a re-entrancy guard.
- Output only the modified or requested code block.

### Working style (user preferences)
- Do git, tests (`node test-migration.js`), and browser preview (preview_* tools) INLINE by default — do NOT spawn subagents for them (a subagent cold-start costs ~30k tokens, ~10x inline). Delegate to a Sonnet 5 low-effort subagent only when context is heavy or the task is long/noisy; if you do, tell it to run the work itself and NEVER re-delegate (subagents recursing on the "delegate git" habit caused an infinite loop once).
- Commit/push only when asked. User works directly on `master` (repo: github.com/Nachodlv/osrs-tracker). Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Keep commit bodies to one short paragraph.
- Node isn't on the shell PATH; in PowerShell prepend it: `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`.
- Local dev server: `.claude/launch.json` config named `iron-tracker-server` (python server.py). `state` and other top-level `let`/`const` are NOT on `window`; `function` declarations (e.g. `getGraph`, `reparentNode`, `render`) ARE, so use those from `preview_eval`.

## Current state (resume context)
- **`state.rootGoals`** ({id:true}): built-in goals detached from every parent are promoted here so they survive `pruneRemoved` as standalone top-level goals (custom nodes do this via `parentId:null`). Defaulted, remapped in `migrateStateData`, tested (15 migration tests).
- **Hiscores**: `hiscoresEndpoint()` uses server.py's `/api/hiscores` on localhost, else the Cloudflare Worker `https://osrs-hiscores.nachodelavega97.workers.dev` (code in `cloudflare-worker/`, `ALLOW_ORIGIN` currently `*`). So the app can run as a static site (e.g. GitHub Pages) without server.py; only hiscores needs the proxy.
- **Edge retargeting**: each edge now renders TWO grab handles (parent end + child end), both reparenting the child — the child-end handle stays grabbable when a parent's children stack their handles at the one parent.
- **`getEffectiveTree`** builds custom nodes in TWO passes (register all, then attach) so a custom node parented by another custom node resolves regardless of order — a single pass dropped such nodes (they disappeared on reparent).
- **Uncommitted**: the `getEffectiveTree` two-pass + `reparentNode` clean-move fix (`app.js`, `?v=36`) is not yet committed. Last commit `ef75848` (Cloudflare Worker) is pushed.

## Architecture notes worth knowing

- `shared` keys collapse duplicate requirements (e.g. Eagles' Peak) into one graph node with multiple parents; always key state by `effectiveId(node)`.
- Layout: `computeColumns` (leaves = col 0), `computeRows` per expanded root block. For columns > 0, a node's row defaults to the average of its children's rows, BUT explicit `state.order` wins — this is what makes manual reordering of non-leaf goals work. Reordering writes sequential explicit orders for the whole column (`applyColumnOrder`), otherwise the average-based placement silently overrides the user's intent (this was a real bug: child goals with prerequisites couldn't be reordered).
- Edge retargeting: built-in tree edges can't be edited in `GOAL_DATA`, so detaching one is recorded in `state.removedEdges[parentId]` and the re-attach goes into `state.linkedEdges[newParentId]`. `removedEdges` is applied in `buildGraph` after the tree walk but BEFORE folding `linkedEdges`, so re-linking the same pair later works. Custom nodes are reparented by rewriting `customNodes[id].parentId` directly. Always cycle-check with `isAncestor` before adding an edge.
- Root goals: drag & drop manages tier groups. Non-root goals: drag & drop reorders within a column. These use separate drag source variables (`dragSourceRootId` vs `dragSourceChildId`) — don't merge them.
- The edge layer SVG has `pointer-events: none`; the edge drag handles opt back in with `pointer-events: all`. During an edge drag, set the handle's pointer-events to none so `elementFromPoint` sees the card underneath. Handles are offset ~6px left of the parent card edge because the HTML cards paint above the SVG.
- Export/import: payload is `{ app: "iron-tracker", version, name, exportedAt, state }`. Import always runs `migrateStateData` and lands in a brand-new profile (never overwrites an existing one).

## Environment gotchas (errors hit before, and their fixes)

- **Mounted-folder sync corruption**: when editing files through file tools on this mounted folder, the sandbox-side copy sometimes kept the OLD byte size — new-shorter content got NUL-padded at the end; new-longer content got tail-truncated (a truncated file can still pass `node --check` if it cuts on a comment line!). After any batch of edits, verify every touched file: check tails (`tail`), scan for NUL bytes, and run real tests — don't trust a syntax check alone. Fix by rewriting the file content through the shell (shell writes propagated correctly in both directions).
- `npm install` may be blocked (403 from registry) — don't plan on jsdom etc.; use the vm + DOM-stub approach above.
- Deleting files in the mounted folder from the shell requires requesting delete permission first (`rm` fails with "Operation not permitted" otherwise).
- Remember to remove `__pycache__` if `server.py` gets compiled during checks.
