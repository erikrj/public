---
name: pr-comments-resolve
description: Verify PR comments were fixed and committed, reply on each thread, and mark it resolved
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(git:*), Read, Grep, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-comments-resolve
  version: 2026.07.15.1923
---

Fetch every comment on the GitHub pull request associated with the **current branch**, verify each requested change has actually been made **and committed**, then reply on the thread and mark it resolved on GitHub. This skill does **not** edit code — if a comment is not yet fixed, it is left open. Run `pr-comments-fix` first to make the changes.

## Steps

1. Resolve the PR for the current branch:
   ```sh
   gh pr view --json number,url,headRefName -q '"\(.number)\t\(.url)\t\(.headRefName)"'
   ```
   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, report that and stop.

2. Fetch the inline review threads with their resolution state, node id (needed to resolve), and the first comment's database id (needed to reply):
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
   Also fetch issue / conversation comments (these have no resolve state, so they can only be replied to, not resolved):
   ```sh
   gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
   ```

3. Build the actionable list of **unresolved** inline threads. For each, capture the **path**, **line**, the originating comment's **databaseId**, and the request (verbatim body).
   - Skip threads already marked **resolved**.
   - Skip purely informational comments that request no change (e.g. PR overview summaries).
   - Honor the repository review rules in `.github/copilot-instructions.md` when judging what a comment is actually asking for.

4. Verify each thread before touching it. A thread may only be resolved when the requested change is **present in a commit on the current branch**, not merely in the working tree:
   - Read the referenced file and surrounding context to confirm the change the comment asked for is in fact present.
   - Confirm it is committed, not a pending edit:
     ```sh
     git status --porcelain {path}          # must be clean for that file
     git log --oneline -5 -- {path}         # the fixing commit should be here
     git log -p -1 -- {path}                # inspect the change if needed
     ```
   - Classify each thread as:
     - **fixed-and-committed** — the change is present and committed → proceed to reply + resolve.
     - **fixed-but-uncommitted** — the change is in the working tree only → do **not** resolve; report that it must be committed first.
     - **not-fixed** — the requested change is absent → do **not** resolve; report it as still open.

5. For each **fixed-and-committed** thread, reply on the thread, then resolve it:
   - Post a brief reply that states what was done and cites the commit that addressed it:
     ```sh
     git log -1 --format=%h -- {path}       # short sha that fixed it
     gh api repos/{owner}/{repo}/pulls/{number}/comments/{databaseId}/replies \
       -f body="Fixed in {sha} — {one-line summary of the change}."
     ```
   - Mark the thread resolved using its node `id`:
     ```sh
     gh api graphql -f query='
       mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }
     ' -F id={threadId}
     ```
   - Keep replies short and factual. Do not resolve a thread whose reply failed to post.

6. Report the results. List each thread with:
   - the **file path** and **line**
   - the comment **body** (brief)
   - the outcome: **replied + resolved** (with the cited sha), **left open — uncommitted** , or **left open — not fixed**

   End with a short summary: how many threads were resolved, how many left open and why. If any threads were left open because the fix is uncommitted, remind the user to commit and re-run.
