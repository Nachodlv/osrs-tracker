# Iron Tracker architecture and environment notes

Deep notes split out of CLAUDE.md so they load only when needed. Read this
before touching layout, edge-retargeting, drag & drop, or export/import, or
when you hit an environment/tooling error below.

## Architecture notes worth knowing

- `shared` keys collapse duplicate requirements (e.g. Eagles' Peak) into one graph node with multiple parents; always key state by `effectiveId(node)`.
- Layout: `computeColumns` (leaves = col 0), `computeRows` per expanded root block. For columns > 0, a node's row defaults to the average of its children's rows, BUT explicit `state.order` wins. That is what makes manual reordering of non-leaf goals work. Reordering writes sequential explicit orders for the whole column (`applyColumnOrder`), otherwise the average-based placement silently overrides the user's intent (a real bug: child goals with prerequisites could not be reordered).
- Edge retargeting: built-in tree edges cannot be edited in `GOAL_DATA`, so detaching one is recorded in `state.removedEdges[parentId]` and the re-attach goes into `state.linkedEdges[newParentId]`. `removedEdges` is applied in `buildGraph` after the tree walk but BEFORE folding `linkedEdges`, so re-linking the same pair later works. Custom nodes are reparented by rewriting `customNodes[id].parentId` directly. Always cycle-check with `isAncestor` before adding an edge.
- Root goals: drag & drop manages tier groups. Non-root goals: drag & drop reorders within a column. These use separate drag source variables (`dragSourceRootId` vs `dragSourceChildId`); do not merge them.
- The edge layer SVG has `pointer-events: none`; the edge drag handles opt back in with `pointer-events: all`. During an edge drag, set the handle's pointer-events to none so `elementFromPoint` sees the card underneath. Handles are offset ~6px left of the parent card edge because the HTML cards paint above the SVG.
- Export/import: payload is `{ app: "iron-tracker", version, name, exportedAt, state }`. Import always runs `migrateStateData` and lands in a brand-new profile (never overwrites an existing one).

## Environment and tooling gotchas (errors hit before, and their fixes)

- **Mounted-folder sync corruption**: when editing files through file tools on this mounted folder, the sandbox-side copy sometimes kept the OLD byte size. New-shorter content got NUL-padded at the end; new-longer content got tail-truncated (a truncated file can still pass `node --check` if it cuts on a comment line). After any batch of edits, verify every touched file: check tails, scan for NUL bytes, and run real tests. Do not trust a syntax check alone. Fix by rewriting the file content through the shell (shell writes propagate correctly in both directions).
- **Background-job worktree guard**: background sessions must call `EnterWorktree` before the first file edit, or Edit/Write to the shared checkout is rejected. Preferred flow is to isolate in a worktree and ship via a draft PR. Only edit `master` directly when the user explicitly asks for the work to stay on `master`; in that case confirm before committing, since you are touching their working checkout.
- **Commit messages in the Bash tool**: use `git commit -F -` with a heredoc. Do NOT use PowerShell here-string syntax (`@'...'@`) in the Bash tool; it is PowerShell-only and leaves a literal `@` as the commit subject.
- **Single-commit patch from a worktree**: use `git diff HEAD~1 HEAD`. The worktree base can differ from the main checkout's `master`, so `git diff master HEAD` pulls unrelated files into the patch.
- **preview_* browser tools are not always present** (e.g. background jobs). Do not assume browser preview is available; reproduce graph/state/layout bugs in `test-app.js` and say when a visual check was not possible.
- `npm install` may be blocked (403 from registry); do not plan on jsdom etc., use the vm + DOM-stub harness in `test-app.js`.
- Deleting files in the mounted folder from the shell requires requesting delete permission first (`rm` fails with "Operation not permitted" otherwise).
- Remove `__pycache__` if `server.py` gets compiled during checks.
