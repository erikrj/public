---
name: pr-review-loop
description: Drive the full Copilot review cycle unattended — request review, fix real findings, reject false positives, push, resolve threads, repeat until settled
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(git:*), Bash(date:*), Bash(sleep:*), Bash(wc:*), Bash(tr:*), Read, Edit, Write, Grep, Glob
disable-model-invocation: true
arguments: [rounds]
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-review-loop
  version: 2026.07.25.0946
---

Run the entire PR review cycle for the **current branch** without a human in the loop: request a Copilot review, wait for it, fix what is real, reject what is not, commit and push, reply on and resolve every thread, then go around again. Stop when the PR has settled, and hand back a report the author can audit in one pass.

`$rounds` caps the number of review rounds (default **20**). The cap exists to bound cost and to stop arguments with a reviewer that will not be satisfied — hitting it is a reportable outcome, not a failure to retry harder. In practice the loop settles well before the cap; churn and escalation are the conditions that normally end it.

This skill composes the existing single-step skills rather than reimplementing them. Read each referenced `SKILL.md` and follow its steps as written; if one contradicts this file, the referenced skill wins for its own step.

## Preconditions

1. Resolve the PR for the current branch:
   ```sh
   gh pr view --json number,url,headRefName,isDraft -q '"\(.number)\t\(.url)\t\(.headRefName)\t\(.isDraft)"'
   ```
   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, stop and tell the user to run `/pr-open` first.

2. Confirm the working tree is clean:
   ```sh
   git status --porcelain
   ```
   If it is dirty, stop and report. Uncommitted changes make thread verification unreliable — the loop cannot tell a fix that shipped from one that is merely sitting in the tree. Tell the user to run `/commit-push` first.

## The round

Repeat until a stop condition below is met. Announce the round number before each round so the run is followable in the transcript.

1. **Check for work already waiting.** Fetch the unresolved review threads:
   ```sh
   gh api graphql -f query='
     query($owner:String!,$repo:String!,$number:Int!){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$number){
           reviewThreads(first:100){
             nodes{ id isResolved isOutdated path line
               comments(first:50){ nodes{ databaseId author{login} body createdAt } } } } } } }
   ' -F owner={owner} -F repo={repo} -F number={number}
   ```
   If there are already unresolved, actionable threads, skip to step 4 — there is no point asking for another review when the last one has not been answered. Otherwise continue to step 2.

2. **Request a review.** Capture the cutoff timestamp *first*, so a review that lands mid-request is not missed:
   ```sh
   since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   gh pr edit --add-reviewer "@copilot"
   ```
   `@copilot` is the special value `gh pr edit --add-reviewer` documents for requesting a Copilot review. The requested reviewer then appears on the PR as the login `Copilot`, and the review it submits is authored by `copilot-pull-request-reviewer[bot]` — the three names are not interchangeable, so match each to the surface it belongs to. If `gh pr edit` rejects the value, fall back to the REST endpoint, which takes the login:
   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/requested_reviewers -f 'reviewers[]=Copilot'
   ```
   A draft PR is fine — Copilot reviews drafts. If the request fails for any other reason, stop and report; do not poll for a review that was never requested.

3. **Wait for the review.** Poll until a Copilot review newer than `$since` appears, with a hard timeout:
   ```sh
   deadline=$(( $(date +%s) + 900 ))
   while [ "$(date +%s)" -lt "$deadline" ]; do
     n=$(SINCE="$since" gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate \
       --jq '.[] | select(.user.login=="copilot-pull-request-reviewer[bot]"
                          and .submitted_at > env.SINCE) | .submitted_at' | wc -l | tr -d ' ')
     if [ "$n" -gt 0 ]; then echo "review landed"; break; fi
     sleep 15
   done
   ```
   Two things in that snippet are deliberate and must not be "simplified":

   - **The timestamp comparison happens inside jq**, which compares ISO-8601 strings correctly. Do not rewrite it as a shell string comparison — `[ "$a" ">" "$b" ]` is a syntax error in zsh, and the loop would spin until it timed out on every round.
   - **The jq filter emits one line per match and `wc -l` does the counting.** Do not wrap the filter in `[...] | length`: `gh api --paginate` applies `--jq` to each page separately and concatenates the results, so a per-page `length` returns one number *per page* (`"1\n0\n0\n1"` once the PR has enough reviews to paginate). `[ "$n" -gt 0 ]` then fails with a non-integer error and the loop never sees its review. Counting lines aggregates across pages correctly.

   Typical turnaround is 1–2 minutes; the 15-minute timeout is a backstop. **If the timeout expires, stop the loop and report it** — do not re-request in a tight cycle.

4. **Triage and fix.** Follow `.claude/skills/pr-comments-fix/SKILL.md` in full. Its verdict definitions (`fix` / `reject` / `escalate`) are authoritative — in particular, a finding is judged on whether it identifies a **real defect or rule violation**, not on whether it cites a rule code. It writes the triage record to `.git/pr-triage-{number}.json`.

5. **Codify what generalizes.** Before committing, look at this round's `fix` verdicts and ask which of them describe a mistake that could be made again in any future PR, rather than a one-off in this diff. A finding generalizes when the same class of defect would recur in unrelated code — a misused CLI flag, a footgun in a config format, an API whose behavior surprises the caller. It does **not** generalize when it is specific to this change: a wrong path, a stale filename, a description that drifted from its own steps.

   For each finding that generalizes, add a rule to `.github/copilot-instructions.md`:
   - Append it to the matching domain section with the **next unused number** in that prefix. Numbers are never reused or renumbered — check the existing rules before choosing one.
   - State the rule, then show the wrong and right forms concretely. A rule the reviewer cannot mechanically check is not worth adding.
   - Bump the file's `metadata.version` to the current `YYYY.MM.DD.HHMM`.

   This is what stops the loop from re-fixing the same class of finding on every PR: the rule turns a repeated discovery into a check the reviewer applies up front. Be conservative — a rule that fires on subjective judgment produces noise on every future review, which is worse than the occasional repeat finding. If a finding is borderline, leave it out and note it in the report.

   Record the rule codes added in the round's triage entries so the report can cite them.

6. **Commit and push, but only if code actually changed.**
   ```sh
   git status --porcelain
   ```
   - If there are changes, follow `.claude/skills/commit-push/SKILL.md`. If the push is rejected as non-fast-forward, **stop the loop** and report — do not force-push; the user can run `/rebase`.
   - If there are none, skip this step. Every finding this round was rejected or escalated, so there is nothing new for a reviewer to look at.

7. **Reply and resolve.** Follow `.claude/skills/pr-comments-resolve/SKILL.md` in full. Threads that were fixed get a reply citing the commit; threads that were rejected get a reply stating why, and both are marked resolved. Escalated threads are replied to but left open.

8. **Evaluate stop conditions** (below). If none is met, start the next round.

## Stop conditions

Stop the loop and report when any of these holds:

- **Settled** — the round produced no actionable findings, or every finding was resolved and **no code changed** (step 6 was skipped). With nothing new to review, another round would only re-run the same reviewer against the same diff.
- **Churn** — a comment already rejected in an earlier round has been raised again on the same path with substantially the same content. `pr-comments-fix` flags this from the triage record. Two rejections of the same point means the disagreement is real and belongs to the author, not to another round.
- **Escalation** — a finding was classified `escalate`. Finish the current round (fix, push, resolve everything else), then stop. An escalation is by definition a decision the loop cannot make.
- **Round cap** — `$rounds` rounds have completed (default 20).
- **Hard error** — the review request failed, the poll timed out, or the push was rejected.

Never resolve a thread just to satisfy a stop condition, and never mark the PR ready for review — the PR stays a draft for the author to review and promote.

## Report

Produce one report for the whole run, written to be read by someone who was not watching:

- The PR URL, how many rounds ran, and which stop condition ended the loop.
- Per round: findings fixed (with the files touched), findings rejected (with the reason posted), findings escalated, and the commit sha pushed.
- **Any rules added to `.github/copilot-instructions.md`**, by code, with the finding each came from. These change how every future PR is reviewed, so they need the author's eyes even though nothing in this PR broke.
- **A consolidated "rejected without a code change" list across all rounds**, each with its file, the reviewer's point, and the reason posted to GitHub. This is the highest-value part of the report — it is every place the loop overrode a reviewer on the author's behalf, and it is what the author should read first.
- **A consolidated "needs your decision" list** for escalations and churn, with what the disagreement is.
- Any threads left open and why.

Report honestly. If a round ended on an error, say so and show the output rather than presenting a partial run as a clean one.
