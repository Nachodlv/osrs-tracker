# GitHub automation

CI and scheduled workflows live in `.github/workflows/`. All of them are
dependency-free (checkout + Node, no bundler), matching the app itself.

## `test.yml` , run the test suites

Runs `node test-migration.js` and `node test-app.js` on every push to `master`
and on every pull request. Both runners set `process.exitCode = 1` on failure,
so a broken suite fails the check. This is the CI mirror of the local Stop hook.

## `crawl-ladlor.yml` , detect Ladlord chart drift

Weekly (Mondays 06:00 UTC) and on-demand (`workflow_dispatch`). It runs
`node tools/crawl-ladlor.js --ci`, which:

1. Regenerates `templates/ladlor.json` from `data.js`.
2. Crawls ladlorchart.com and diffs the live goal ids against `data.js`.
3. If the live chart exposes ids missing from `data.js`, bumps the built-in
   Ladlord template `version` in `templates.js` (so pinned profiles get the
   update banner) and writes a drift report.

When drift is found the workflow commits the version bump + regenerated JSON to
a `chore/ladlor-crawl-v<N>` branch and tries to open a PR. Because this repo
disables "Allow GitHub Actions to create and approve pull requests", the default
token cannot open a PR, so it **falls back to opening an issue** labelled
`template-drift` (auto-created if missing) with the drift report and a compare
link. Reruns reuse the open issue/branch instead of piling up duplicates.

The live bundle has no edge list, so the crawler only detects id-level drift; it
never edits `data.js` (parents/icons/links are a human/Claude judgement call).

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
