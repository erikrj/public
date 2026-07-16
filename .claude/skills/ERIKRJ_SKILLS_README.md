# Agent skills

This directory holds repository-scoped agent skills. Each skill lives in `<skillname>/SKILL.md`; the directory name is the skill name.

## PR comment workflow

Three skills work together to handle pull-request review comments on the PR for your **current branch**. They are deliberately split by responsibility so each step is safe to run on its own and easy to review.

| Skill | What it does | Touches code? | Touches GitHub? |
|---------|--------------|:-------------:|:---------------:|
| `pr-comments` | Lists every comment on the PR (review summaries, inline diff comments, conversation comments) with full details and resolution status. Read-only. | No | Reads only |
| `pr-comments-fix` | Fetches the comments and edits the working tree to resolve them. Does not commit, push, reply, or resolve threads. | Yes (working tree) | Reads only |
| `pr-comments-resolve` | Verifies each requested change is present **and committed**, then replies on the thread and marks it resolved on GitHub. Never edits code. | No | Reads + writes |

All three resolve the PR from the current branch and pull comments from the four places GitHub stores them (review summaries, inline diff comments, issue/conversation comments, and GraphQL review-thread state).

### Typical flow

```text
1. pr-comments           # review what reviewers asked for
2. pr-comments-fix       # let the agent make the code changes
3. (review the diff yourself, then commit + push)
4. pr-comments-resolve   # reply on each thread and mark it resolved
```

Step 3 is intentionally manual: `pr-comments-fix` stops at the working tree so you can inspect and commit the changes yourself. `pr-comments-resolve` will **not** resolve a thread whose fix is uncommitted — it reports it as "left open — uncommitted" so nothing gets marked done before it's actually on the branch.

### Notes

- **Current-branch scoped.** Each command operates on the PR for the branch you have checked out. If there is no PR for the branch, the command reports that and stops.
- **Respects repo rules.** The fix and resolve steps honor the conventions in `CLAUDE.md` and `.github/copilot-instructions.md` (rule codes, formatting, validation library, etc.) when deciding what a comment asks for and how to address it.
- **Skips noise.** Informational comments (e.g. PR overview summaries) and already-resolved threads are skipped automatically.
- **Requires the GitHub CLI.** All three rely on an authenticated [`gh`](https://cli.github.com/) and use `gh api` / `gh api graphql` under the hood.

## Security & quality findings workflow

Two skills work together to surface and fix GitHub's security and quality alerts for the **whole repository**. Like the PR-comment skills, they are split so reporting is read-only and fixing is an explicit, per-finding action.

| Skill | What it does | Touches code? | Touches GitHub? |
|---------|--------------|:-------------:|:---------------:|
| `gh-findings` | Reports all open findings from code scanning, Dependabot, and secret scanning, with summary stats and a full listing. Each finding includes a paste-to-run `gh-fix <url>` line. Read-only. | No | Reads only |
| `gh-fix <url>` | Fixes one finding identified by its alert URL, then puts the fix on a fresh `{user}/{name}` branch and opens a PR. Does not dismiss the alert. | Yes (commits) | Opens a PR |

`gh-fix` handles each source differently:

- **Code scanning** — reads the flagged file/line and applies the minimal in-code fix for the rule.
- **Dependabot** — upgrades the affected package to its patched version (via `pnpm`), never adding a new dependency.
- **Secret scanning** — removes the secret from the code and tells you to **rotate the credential out-of-band**; Claude cannot rotate it, and removal does not purge it from git history.

### Typical flow

```text
1. gh-findings                           # see every open alert, each with a gh-fix line
2. gh-fix <alert-url>                    # fix one finding on its own branch + PR (repeat per finding)
3. review/merge the PR — alerts close once merged (or after rotation)
```

### Notes

- **No click-to-fix.** Terminal links are not clickable into the session, so `gh-findings` prints `gh-fix <url>` as a line you copy and paste. `gh-fix` fixes one finding per run — it never auto-fixes everything.
- **One finding, one PR.** `gh-findings` only reads. `gh-fix` commits the fix to a fresh `{user}/{name}` branch (the `branch-clean` convention) and opens a PR, but never dismisses or resolves an alert on GitHub — alerts close when the PR merges (Dependabot/code scanning) or the secret is rotated. It requires a clean working tree so the PR contains only the fix.
- **Respects repo rules.** `gh-fix` follows the conventions in `CLAUDE.md` and `.github/copilot-instructions.md`, and defers to you when a fix would add a dependency or can't be made safely.
- **Requires the GitHub CLI.** Both rely on an authenticated [`gh`](https://cli.github.com/) with access to the repo's security alerts.

## Other skills

| Skill | What it does | Touches code? | Touches GitHub? |
|---------|--------------|:-------------:|:---------------:|
| `commit` | Stages all modified, deleted, and untracked files and commits them locally with a descriptive message. Commits the working tree as-is — never drops or reverts a change based on its own judgment. Refuses to commit to `main` and does not push. | Stages + commits | No |
| `commit-push` | Same as `commit`, then pushes the branch to its remote (setting upstream if needed). Commits the working tree as-is — never drops or reverts a change based on its own judgment. Refuses `main`; never force-pushes. | Stages + commits | Pushes |
| `rebase` | Fetches and rebases the current branch onto `origin/main`, resolving any conflicts, then force-pushes with `--force-with-lease` (skipped if the branch has no upstream). Refuses to run with a dirty working tree; never plain force-pushes. | Rebases (rewrites commits) | Fetches + force-pushes (with lease) |
| `branch-clean` | Stashes local changes, fetches, and starts a fresh short `{user}/{name}` branch off the updated `origin/main`, then drops the old branch and restores the stash. | Stashes/restores | Fetches only |
| `branch-done` | Finishes the current branch: switches to `main`, pulls the latest (fast-forward), and deletes the old branch locally — safely, or force-deleting only when its PR is merged. Refuses a dirty tree. | Switches/pulls | Fetches only |
| `pr-create` | Pushes the current branch and opens a draft GitHub PR against `main`, with a succinct title and body written as the squash-merge commit. | No | Pushes + opens draft PR |
| `codereview <path>` | Recursively reviews a single path against the rules in `CLAUDE.md` and `.github/copilot-instructions.md`, prints the violations it finds, and maintains the outstanding-violations backlog in `CODEREVIEW.md` (removing findings a rerun no longer finds). Reports only; does not edit reviewed code. | Writes `CODEREVIEW.md` | No |
| `clientloop-release-notes` | Reads the `Platform` CodePipeline in the `clientloop-devops` AWS account for deploys that reached production, pulls each deploy's PR from `nr1etech/nr1e`, and updates two ClientLoop docs pages: a filtered customer-facing release-notes page and a per-deployment internal log (`release-notes-internal.md`, excluded from the sitemap). Reads AWS + GitHub; does not commit. | Writes docs release-notes pages | Reads only |
| `skills-update` | Refreshes every installed skill (and all its related files) **and** other tracked distributed files (e.g. `.github/copilot-instructions.md`) from the `metadata.source` GitHub URL declared in each file — a `/tree/` URL for a skill directory or a `/blob/` URL for a single file — overwriting local copies with the authoritative source. Reports updated/unchanged/stale per item; does not commit or push. | Writes skill + tracked files | Reads only |

## Adding a skill

Create a new `<name>/SKILL.md` file in this directory with YAML frontmatter:

```markdown
---
description: One-line summary shown in the command list
allowed-tools: Bash(gh:*), Read, Edit
---

Instructions for Claude, written as a prompt...
```

The `description` summarizes the skill, and `allowed-tools` restricts which tools the skill may use.
