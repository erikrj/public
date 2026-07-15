---
name: clientloop-release-notes
description: Update the customer-facing and internal ClientLoop release notes from production pipeline deployments
allowed-tools: Bash(aws:*), Bash(gh:*), Bash(jq:*), Bash(clientloop/scripts/release-notes-deploys.sh:*), Read, Edit, Write
disable-model-invocation: true
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/clientloop-release-notes
  version: 2026.07.15.1935
---

Turn ClientLoop **production deployments** into two docs pages: a polished,
customer-facing release-notes page and a detailed, internal per-deployment log.
The flow is: find what reached production → pull the PR behind each deploy →
write both pages → update each page's marker.

## What "deployed to production" means here

ClientLoop ships through a single self-mutating CDK CodePipeline named
**`Platform`**, defined in `cdk/src/clientloop/pipeline-stack.ts`. It runs in the
**clientloop-devops** AWS account and deploys Stage first, then Connect, then
Production. The prod stages are last in the pipeline (`Platform-ProdGlobal`,
`ProdRegionalWave`, `Platform-ProdEdge`), so an execution whose overall status is
**`Succeeded`** has passed all the way through production. `InProgress` and
`Failed` executions have **not** reached prod and must be ignored.

| Thing | Value |
|-------|-------|
| Pipeline | `Platform` |
| AWS profile | `clientloop-devops` (account `949815493512`) |
| AWS region | `us-east-2` |
| GitHub repo | `nr1etech/nr1e` |
| Customer page | `clientloop/docs/docs/release-notes.md` |
| Internal page | `clientloop/docs/docs/release-notes-internal.md` (`sitemap: false`) |
| Docs nav config | `clientloop/docs/docs/docs.yaml` |
| Collector script | `clientloop/scripts/release-notes-deploys.sh` |

Each pipeline execution records the git commit SHA it deployed and the
squash-merge commit message, which ends with the PR number as `(#NNN)`.

### The two pages

- **Customer page** (`release-notes.md`) — for customers and integration
  developers. Curated and **filtered**: rewrite PRs into plain benefits, group by
  date, and omit internal-only churn. It's in the sitemap.
- **Internal page** (`release-notes-internal.md`) — for the team. A complete
  engineering log: **one entry per production deployment**, newest first, with
  the deploy date **and time** and the PR behind it. Nothing is filtered out, and
  internal detail (PR numbers, commit SHAs, service names) is welcome. It's
  excluded from the sitemap via the `sitemap: false` flag on its nav item. A
  `:::deploys` marker just below the intro renders a GitHub-style heatmap of
  deploys per day, built automatically from the dated entry headings — keep the
  marker; never hand-write the heatmap.

The two pages are updated **independently** — each carries its own marker and may
be at a different cutoff (e.g. the customer page can be caught up while the
internal page still needs backfilling). Process each against its own marker.

## Prerequisites

- An active AWS SSO session for the devops account. If a command returns an
  auth/expired-token error, stop and ask the user to run `aws sso login
  --profile clientloop-devops` (interactive — they should run it via `!` in the
  prompt), then continue.
- `gh` authenticated against `nr1etech/nr1e`.

## Steps

1. **Read each page's marker.** Both pages carry an invisible marker on their
   first line recording the last production deploy already written up:

   ```
   <!-- last-deploy-sha: e5abb098de3476488b52edc78cb30b3fe645758a -->
   ```

   Read `clientloop/docs/docs/release-notes.md` and
   `clientloop/docs/docs/release-notes-internal.md`. Capture each page's marker
   SHA separately. A page with no marker is on its **first run** — there's no
   cutoff, so you'll scan recent history and pick a starting point with the user
   (a calendar window like "the last 4 weeks" works well). The two markers are
   often equal but don't assume it.

2. **Collect new deploys per page** with the read-only collector, passing that
   page's marker as `--since-sha`. It lists `Succeeded` `Platform` executions,
   trims to those newer than the cutoff, and attaches each deploy's PR:

   ```sh
   # Per page, newer than that page's marker:
   clientloop/scripts/release-notes-deploys.sh --since-sha <sha-from-that-page>

   # First run (no marker): scan deeper, then filter to the agreed window:
   clientloop/scripts/release-notes-deploys.sh --max 300
   ```

   It prints a JSON array, **newest-first**, where each element has `sha`,
   `completedAt` (ISO timestamp, in `-06:00`/`-07:00` = America/Denver, of when it
   finished deploying to prod), `commitMessage`, `prNumber`, and `pr`
   (`{number, title, body, url, mergedAt, author, labels}`, or `null` when no PR
   was found). The script only reads — it never writes.

   If a page's array is empty, that page is already current; leave it untouched.
   If both are empty, tell the user nothing new reached production and stop.

3. **Customer page — write filtered, customer-facing entries.** Write for
   **customers and integration developers**, not engineers. The raw PR title and
   body are source material, not the output. For each deploy:

   - **Lead with the customer benefit** — one plain-language bullet: what can a
     customer now do, or what problem went away? Bold a short lead phrase.
     - "Add public /signup route with embedded apply and theme toggle"
       → `- **Self-service signup** — prospective merchants can now apply directly at /signup, with light and dark themes.`
     - "Default Org.status for records predating the status field"
       → `- **Fixed loading older organizations** — resolved an error that could occur when loading organizations created before a recent update.`
   - **Omit internal-only changes.** Customers don't care about build tooling,
     refactors, dependency bumps, schema/codegen regeneration, tests, CI, or
     lockfile churn — drop them. The repo doesn't label PRs reliably, so judge
     from the title and body (signals of internal work: "build", "bundle",
     "lockfile", "refactor", "rename", "regenerate", "schema artifacts", "tests",
     "lint", "CI", "type", "import"). When unsure, keep it but phrase it
     conservatively.
   - **Group, don't enumerate.** If several PRs make one customer-visible feature,
     write one bullet. Don't expose PR numbers, SHAs, or internal service names
     (graph, edge, regional, lambda) in the customer text.
   - **Flag breaking changes** in their own `- **Breaking:** ...` bullet
     describing what integrators must change.

   **Group by date:** group deploys by the calendar date of `completedAt` in
   **America/Denver**, one `##` section per date (e.g. `## June 28, 2026`),
   newest date first. Skip a date entirely if, after filtering, it has no
   customer-facing changes.

4. **Internal page — write one entry per deployment.** No filtering: **every**
   production deploy in the page's new set gets an entry, newest first. Include
   the deploy date and time and the PR. Use this shape:

   ```markdown
   ## 2026-06-28 · 7:20 PM MDT — Add public /signup route (#550)

   - PR [#550](https://github.com/nr1etech/nr1e/pull/550) by @erikrj · commit `e5abb098`
   - Adds a public, unauthenticated `/signup` route rendering the embedded apply
     component, with light/dark theming for the auth screens.
   ```

   - **Heading:** the deploy timestamp formatted from `completedAt` in
     America/Denver (`YYYY-MM-DD · h:mm AM/PM` plus `MST`/`MDT`), an em dash, the
     PR title, and `(#NNN)`.
   - **First line:** a link to the PR (`pr.url`), the author (`@pr.author.login`),
     and the short commit SHA (first 8 chars of `sha`).
   - **Detail:** one to three sentences on what shipped, drawn from the PR
     title/body. Keep internal specifics — this page is for the team.
   - For a deploy with no PR (`pr: null`), use the `commitMessage`: first line as
     the heading title, and note it was a direct push instead of a PR link.

5. **Update each page.** Both are plain Markdown rendered by the docs site, with
   the marker as line 1:

   ```markdown
   <!-- last-deploy-sha: <NEWEST deploy sha you processed for THIS page> -->
   # Release Notes
   ...
   ```

   - **Prepend** new sections/entries above the existing ones (newest-first is
     preserved because the collector returns newest-first). On the internal page
     the `:::deploys` heatmap marker sits between the intro and the first entry —
     prepend new entries **below** it, and leave the marker in place.
   - **Update each page's marker** to the `sha` of the newest deploy you processed
     for that page (the first collector element) — for the customer page, do this
     even if that newest deploy was filtered out as internal-only, so the next run
     doesn't re-scan it.
   - **First run:** each page ships as a scaffold — header, intro, and a single
     placeholder sentence (`_No … yet …_`) with no marker. Add the marker on line
     1 and **replace** the placeholder with your content so it doesn't linger
     beneath the entries. On the internal page, keep a `:::deploys` line between
     the intro and the first entry so the deploy heatmap renders.
   The marker is an HTML comment, so it never renders on the page.

   - If a page is missing entirely (e.g. deleted), recreate it with its header and
     re-register it in `clientloop/docs/docs/docs.yaml` (leave the nav alone if
     its entry already exists). Preserve the nav flags: the customer page uses
     `toc: false`, and the internal page uses `sitemap: false, menu: false, toc:
     false` (excluded from the sitemap, hidden from the sidebar menu — reachable
     only by direct URL — and rendered without the "On this page" outline):

     ```yaml
       - title: Release Notes
         items:
           - { title: Release Notes, path: release-notes.md, toc: false }
       - title: Internal
         items:
           - { title: Internal Release Notes, path: release-notes-internal.md, sitemap: false, menu: false, toc: false }
     ```

6. **Report back.** Summarize what you added to each page: the customer-page
   dates/bullets, the internal-page entry count, how many deploys you processed,
   and which you omitted from the **customer** page as internal-only (one-line
   reason each) so the user can sanity-check the filtering. Do **not** commit or
   push unless asked — when asked, the repo's normal commit conventions apply
   (see `/commit` and `AGENTS.md`).

## Notes & edge cases

- **Independent markers.** The customer page can be current while the internal
  page needs a full backfill (or vice versa). Always drive each page from its own
  marker, not the other's.
- **Re-runs are safe.** Each marker makes the collector return only that page's
  new deploys, so re-running won't duplicate entries — as long as you update both
  markers in Step 5.
- **Don't widen scope to non-prod.** Stage deploys and failed/in-progress
  executions are intentionally excluded; only `Succeeded` executions belong on
  either page.
