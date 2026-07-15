---
name: pr-comments-fix
description: Fetch the GitHub PR comments for the current branch and fix the code to resolve them
allowed-tools: Bash(gh:*), Bash(jq:*), Read, Edit, Write, Grep, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-comments-fix
  version: 2026.07.15.1923
---

Fetch every comment on the GitHub pull request associated with the **current branch**, then fix the code to resolve them. This skill only edits code in the working tree — it does **not** commit, push, reply to threads, or mark threads resolved on GitHub.

## Steps

1. Resolve the PR for the current branch:
   ```sh
   gh pr view --json number,url -q '"\(.number)\t\(.url)"'
   ```
   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, report that and stop.

2. Fetch all four sources of comments (a GitHub PR splits them across endpoints):

   - **Review summary comments** (the top-level body of each submitted review):
     ```sh
     gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
     ```
   - **Inline review (diff) comments** — anchored to a file and line:
     ```sh
     gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
     ```
   - **Issue / conversation comments** — the general discussion thread:
     ```sh
     gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
     ```
   - **Review-thread resolution state** (whether an inline thread is resolved/outdated), via GraphQL:
     ```sh
     gh api graphql -f query='
       query($owner:String!,$repo:String!,$number:Int!){
         repository(owner:$owner,name:$repo){
           pullRequest(number:$number){
             reviewThreads(first:100){
               nodes{ isResolved isOutdated path
                 comments(first:1){ nodes{ databaseId author{login} } } } } } } }
     ' -F owner={owner} -F repo={repo} -F number={number}
     ```

3. Build the actionable list. For each comment, capture the **author**, **file path** and **line** (for inline comments), the **body** (verbatim), and the thread's **resolved / outdated** status.
   - Skip threads already marked **resolved**.
   - Skip review entries whose body is empty AND state is COMMENTED (container records for inline-only reviews).
   - Skip purely informational comments that request no change (e.g. PR overview summaries).
   - Honor the repository review rules in `.github/copilot-instructions.md` when judging what a comment is actually asking for.

4. Fix the code. For each actionable comment:
   - Read the referenced file and surrounding context before editing.
   - Make the **minimal change** that resolves the comment. Do not refactor unrelated code.
   - Follow the project conventions in `CLAUDE.md` and `.github/copilot-instructions.md` (rule codes, formatting, validation library, etc.).
   - If a comment is ambiguous, disagrees with an intentional design, or cannot be safely fixed, **leave the code untouched** and record why it was skipped.

5. Report the results. List each comment with:
   - the **file path** and **line**
   - the comment **body** (brief) and its **URL** (`html_url`)
   - **what was changed** (the files/edits made) or **why it was skipped**

   End with a short summary: how many comments were fixed, how many skipped, and a reminder that nothing was committed, pushed, or resolved on GitHub.
