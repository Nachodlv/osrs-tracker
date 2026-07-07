# GitHub automation

CI and scheduled workflows live in `.github/workflows/`. All of them are
dependency-free (checkout + Node, no bundler), matching the app itself.

## `test.yml` , run the test suites

Runs `node test-migration.js`, `node test-app.js`, and `node test-crawl.js` on
every push to `master` and on every pull request. Each runner sets
`process.exitCode = 1` on failure, so a broken suite fails the check. This is the
CI mirror of the local Stop hook. `test-crawl.js` covers the crawl tool's pure
logic (group classification and the `data.js` writer); the browser render path
is not covered.

## `crawl-ladlor.yml` , detect Ladlord chart drift

Weekly (Mondays 06:00 UTC) and on-demand (`workflow_dispatch`). It runs
`node tools/crawl-ladlor.js --ci`, which:

1. Regenerates `templates/ladlor.json` from `data.js`.
2. Crawls ladlorchart.com and diffs the live goal ids against `data.js`.
3. Renders the live SPA and diffs its tier-group layout against `GEAR_GROUPS`
   (see "Group drift" below).
4. Auto-wires purely-additive new goals into `data.js` (see "Auto-wiring" below).
5. If anything drifted, bumps the built-in Ladlord template `version` in
   `templates.js` (so pinned profiles get the update banner) and writes a drift
   report with a section per kind of drift.

When drift is found the workflow commits the version bump + regenerated JSON (and
any auto-wired `data.js` change) to a `chore/ladlor-crawl-v<N>` branch and tries
to open a PR. Because this repo disables "Allow GitHub Actions to create and
approve pull requests", the default token cannot open a PR, so it **falls back to
opening an issue** labelled `template-drift` (auto-created if missing) with the
drift report and a compare link. Reruns reuse the open issue/branch instead of
piling up duplicates.

### Auto-wiring new goals

For a **purely additive** change, a new gear item joining an existing tier, or a
whole new tier of all-new items while nothing disappeared, the crawl writes the
flat goal into `data.js` (id `gear.<slug>`, with title/icon/link/type read from
the rendered node) and slots it into `GEAR_GROUPS`, then regenerates the
template. The PR therefore arrives with the easy cases already wired in.

It never auto-applies **renames, removals, or ambiguous regroupings**: a
misjudged rename would add a fresh id without an `ID_MIGRATIONS` entry and
silently orphan saved progress. Those, plus any new id that is not in a tier
group, are listed in the drift report under "Needs manual review" for a
maintainer (or the `@claude` workflow) to wire in with a migration. So the crawl
still never touches parent/child structure or migrations on its own.

### Group drift (`--groups`)

The tier columns (`.node-group`) only exist in the rendered DOM, so id-level
crawling of the bundle cannot see them. `--groups` renders the live SPA and
diffs its groups against `GEAR_GROUPS`, reporting members added/removed and whole
groups that appeared or disappeared (robust to reordering, groups are paired by
member overlap). It also previews the auto-wiring plan (which new goals `--ci`
would write, and which are held for review) without touching any file. This runs
as steps 3-4 of `--ci`, and can also be run locally:

```
node tools/crawl-ladlor.js --groups          # print the group diff
node tools/crawl-ladlor.js --groups --emit    # also print a paste-ready
                                              # GEAR_GROUPS block in live order
```

Rendering goes through Chrome over the DevTools Protocol using only Node
built-ins (`tools/render-chrome.js`), so the tool stays dependency-free but needs
a Chrome/Chromium present. The workflow points `CHROME_PATH` at the one
preinstalled on `ubuntu-latest`; locally it auto-detects, and `CHROME_PATH`
overrides. In `--ci` the group check is best-effort: if the render fails the run
logs a warning and still reports id drift.

## `claude.yml` , wire drifted goals in on demand

Comment `@claude ...` on an issue or PR and Claude Code adds the change on a
branch, runs the tests, and opens a draft PR. The typical use is a
`template-drift` issue: comment `@claude wire these new goals into data.js` and
it adds them with the right icons/links (using the `data.js` resolution helpers)
and regenerates the template.

Notes:

- **Comment-only triggers.** It runs only when a *comment* mentions `@claude`,
  never on issue creation, so the crawl issue can print a "comment @claude" hint
  without self-triggering (Option B: on-demand, human in the loop).
- **Auth.** Uses a Claude subscription OAuth token (Pro/Max), not a metered API
  key. Generate it with `claude setup-token` and store it as the
  `CLAUDE_CODE_OAUTH_TOKEN` repo secret; also install the Claude GitHub App on
  the repo so it can comment and open PRs.
- **Default-branch rule.** `issue_comment` workflows only run from the file on
  the default branch, so `claude.yml` responds to `@claude` only after it is
  merged to `master`.
- Bounded with `--max-turns 40`. Keep its PRs as drafts for review, since parent
  placement and tier-group membership are the parts most likely to need fixing.
