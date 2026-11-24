---
name: skills-update
description: Update every installed skill and other tracked files (e.g. copilot-instructions.md) from each file's authoritative source URL in its metadata, on a fresh branch, and open a draft PR with the result
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(mkdir:*), Bash(git:*), Read, Write, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/skills-update
  version: 2026.11.24.1724
---

Refresh every installed skill — **and** the repository's other tracked
distributed files — from its **authoritative source**. Each `SKILL.md` (and each
tracked file, such as `.github/copilot-instructions.md`) carries a
`metadata.source` URL pointing at where it was published from. This skill walks
every tracked item, re-downloads its source, and overwrites the local copy so it
matches the source exactly:

- A **skill** source is a GitHub **tree** URL (a directory). Re-download the
  **entire** directory — the `SKILL.md` **and** all related files (references,
  scripts, assets, nested folders).
- A **tracked file** source is a GitHub **blob** URL (a single file). Re-download
  just that one file to its path in the repository.

**The update ships as its own pull request.** The skill cuts a fresh branch from
an up-to-date `origin/main`, writes the refreshed files there, commits them,
pushes, and opens a **draft** PR — so a sync is always reviewed as one isolated
change and never lands mixed into unrelated work. When nothing changed, no
branch, commit, or PR is left behind. The only way to skip the branch and PR is
for the user to say so in the same request (e.g. "update the skills but don't
open a PR"); then skip steps 2 and 9, write the files into the current working
tree, and stop there.

**Update everything tracked, not a subset.** Invoking this skill means refresh
all installed skills that declare a source **and** every tracked file. Do not
pick and choose. If the user names specific items in the same request, limit to
those; otherwise do them all.

## Assumptions & guards

- Requires an authenticated GitHub CLI (`gh auth status`). If `gh` is not
  authenticated, stop and tell the user to run `gh auth login`.
- Only `github.com` URLs are supported — a `/tree/` URL for a skill directory or
  a `/blob/` URL for a tracked file. If a `source` points at a different host (or
  is neither a `/tree/` nor a `/blob/` URL), skip it and report it as
  **unsupported** — do not guess how to fetch it.
- Requires a **clean working tree** (`git status --porcelain` prints nothing).
  The commit step ships everything in the tree, so any change already there
  would be swept into the sync PR — and an uncommitted local edit to a skill
  would be overwritten outright. If the tree is dirty, stop **before** switching
  branches or writing anything, and tell the user to commit or stash first.
- The fetch is **authoritative-wins**: local files are overwritten with the source
  version. Files that exist locally but are **absent from the source** are **not**
  deleted automatically — they are reported as **stale** so the user can decide.

## Steps

1. Locate the skills directory and the repo root. This skill lives at
   `<SKILLS_DIR>/skills-update/SKILL.md`, so `SKILLS_DIR` is the parent of this
   skill's own directory — the directory that holds every `<name>/SKILL.md`. Use
   the skill's base directory to resolve it; do not hardcode a path. Resolve the
   repository root too (`git rev-parse --show-toplevel`) — tracked files are
   written relative to it.

2. Cut the branch the update will ship on. First apply the clean-tree guard and
   record where the run started, so it can return there if there turns out to
   be nothing to update:
   ```sh
   git status --porcelain              # must print nothing — otherwise stop
   git rev-parse --abbrev-ref HEAD     # starting branch — remember as {old}
   git rev-parse HEAD                  # starting commit — remember as {old-sha}
   gh api user -q .login               # remember as {user}
   ```
   `{old}` is the literal string `HEAD` when the checkout is detached; that is
   what `{old-sha}` is for.

   Name the branch `{user}/skills-update`. If that name is already taken locally
   or on the remote — typically an earlier sync whose PR is still open — append
   `-2`, `-3`, … until it is free:
   ```sh
   git fetch origin main
   git branch --list "{user}/skills-update*"
   git ls-remote --heads origin "{user}/skills-update*"
   git switch --no-track -c {user}/skills-update origin/main
   git rev-parse HEAD                  # the new branch's tip — remember as {new-sha}
   ```
   Remember the name actually used — suffix included — as `{new}`. Every later
   step refers to the branch by `{new}`, never by the unsuffixed name, which may
   belong to an earlier run.

   The branch is cut **before** any file is fetched, not after, so the refreshed
   files are written directly on top of current `main` and the PR's diff is
   exactly "source vs. `main`". Carrying them over from the starting branch
   afterwards would conflict whenever that branch and `main` disagree about a
   skill. Leave `{old}` in place — it is the user's branch, and this skill has no
   business deleting it.

   Switching to `origin/main` can change the files on disk under `SKILLS_DIR`,
   including this one. Build the item list in the next step from what is on disk
   **after** the switch: the PR targets `main`, so `main`'s set of skills is the
   set to refresh.

3. Build the list of tracked items to refresh:
   - **Skills** — every immediate subdirectory of `SKILLS_DIR` that contains a
     `SKILL.md`:
     ```sh
     ls -d "$SKILLS_DIR"/*/SKILL.md
     ```
   - **Tracked files** — standalone files that carry their own `metadata.source`
     frontmatter but are not a skill's `SKILL.md`. Currently these are:
     - `<repo-root>/.github/copilot-instructions.md`
     - `<SKILLS_DIR>/ERIKRJ_SKILLS_README.md`

     Include a tracked file only if it exists locally; note any that are missing.
     (This list is intentionally explicit — these files are not discovered by the
     `<name>/SKILL.md` walk, even when they sit inside `SKILLS_DIR`.)

4. For each item (a skill's `SKILL.md` or a tracked file), extract its
   `metadata.source`. It is the `source:` line nested under the `metadata:` key in
   the YAML frontmatter:
   ```sh
   src=$(awk '
     /^metadata:/      {inmeta=1; next}
     inmeta && /^[^[:space:]]/ {inmeta=0}
     inmeta && /^[[:space:]]+source:[[:space:]]/ {
       sub(/^[[:space:]]+source:[[:space:]]*/, ""); print; exit
     }' "$skill_md")
   ```
   - If there is no `source`, skip the item and report it as **no-source**.

5. Parse the GitHub URL and note its **kind**. Split on `/`: `OWNER` and `REPO`
   are the two segments after `github.com`, the next segment is the **kind**
   (`tree` or `blob`), the segment after that is `REF`, and everything after `REF`
   is `PATH`.
   - A **`tree`** URL (`https://github.com/<OWNER>/<REPO>/tree/<REF>/<PATH...>`)
     means `PATH` is a **directory** (a skill), e.g. `.claude/skills/branch-clean`.
   - A **`blob`** URL (`https://github.com/<OWNER>/<REPO>/blob/<REF>/<PATH...>`)
     means `PATH` is a **single file** (a tracked file), e.g.
     `.github/copilot-instructions.md`.

   Assume `REF` is a **single** segment (e.g. `main`); if the branch name itself
   contains slashes the parse is ambiguous — skip and report it as
   **unsupported**. A URL that is neither `tree` nor `blob`, or not on
   `github.com`, is also **unsupported**.

6. Fetch and write the source, depending on the kind:

   - **`tree` (skill directory).** List every file under `PATH` in one call with
     the recursive Git-tree API, keeping only the blobs under `PATH`:
     ```sh
     gh api "repos/$OWNER/$REPO/git/trees/$REF?recursive=1" \
       --jq ".tree[] | select(.type==\"blob\") | .path" \
       | grep -E "^$(printf '%s' "$PATH" | sed 's/[.[\*^$/]/\\&/g')(/|$)"
     ```
     An empty list means the directory does not exist at that ref — report the
     item as **source-missing** and move on (do not delete anything locally). For
     each source blob, compute its path **relative** to `PATH` (strip the `PATH/`
     prefix) and write it into the local skill directory, creating parent dirs:
     ```sh
     rel=${blob#"$PATH"/}
     dest="$skill_dir/$rel"
     mkdir -p "$(dirname "$dest")"
     gh api -H "Accept: application/vnd.github.raw" \
       "repos/$OWNER/$REPO/contents/$blob?ref=$REF" > "$dest"
     ```

   - **`blob` (tracked file).** Download just that one file and write it to
     `<repo-root>/$PATH` (its path is already repo-relative), creating parent dirs:
     ```sh
     dest="$REPO_ROOT/$PATH"
     mkdir -p "$(dirname "$dest")"
     gh api -H "Accept: application/vnd.github.raw" \
       "repos/$OWNER/$REPO/contents/$PATH?ref=$REF" > "$dest"
     ```
     A `404` means the file does not exist at that ref — report it as
     **source-missing** and leave the local copy untouched.

   Write every file **exactly** as fetched — do not reformat, re-wrap, or "fix"
   the content. The source is authoritative.

7. For a **skill** directory, detect **stale** local files — files under the local
   skill directory that were **not** in the source blob list. Report them; do
   **not** delete them unless the user asks you to prune. (A common stale file is
   an intentional local rename or a local-only note.) Tracked single files have no
   stale-file concept.

8. Move to the next item and repeat. Note two things while iterating:
   - **Self-update.** If `skills-update` itself is refreshed, its `SKILL.md` is
     rewritten on disk mid-run. The instructions already loaded for *this* run are
     unaffected; the new version takes effect next time.
   - Keep going if one item fails (network error, missing source) — collect the
     failure and continue so one bad source does not abort the whole update.

9. Ship the result — unless a download went wrong. The fetches in step 6
   redirect straight into the destination, so a request that failed, or a
   tracked file whose source returned `404`, has already left an empty or
   partial file where the good copy was. Committing now would publish that
   damage alongside the successful updates. So if any item is **failed**, or any
   **tracked file** is **source-missing**, do **not** commit, push, or open a
   PR, and do not clean up either: leave the working tree as it is on `{new}`
   for recovery, and go to step 10 to report which destinations are damaged.
   `git restore -- <path>` brings back the pre-update copy of any of them, since
   the tree was clean when the run started.

   Otherwise check whether the update changed anything:
   ```sh
   git status --porcelain
   ```
   - **Nothing changed** (empty output — every item was unchanged or skipped).
     There is nothing to open a PR for, so undo step 2 rather than leave an
     empty branch behind: return to the starting point, then delete the branch
     this run created — `{new}`, and only if its tip is still where step 2 left
     it.
     ```sh
     git switch {old}                  # or: git switch --detach {old-sha}  when {old} is HEAD
     git rev-parse {new}               # must equal {new-sha} — otherwise leave {new} alone
     git branch -D {new}
     ```
     The delete is forced because the safe form judges "merged" against the
     checkout just restored, and refuses whenever `{old}` is behind the freshly
     fetched `main` — which is the ordinary case. Comparing the tip to
     `{new-sha}` first is what makes forcing safe: an unchanged tip is a commit
     already on `origin/main`, so nothing can be lost. If the switch back fails
     or the tip has moved, delete nothing and report that `{new}` was left in
     place.
   - **Something changed.** Follow `<SKILLS_DIR>/commit/SKILL.md` to stage and
     commit everything, then `<SKILLS_DIR>/pr-create/SKILL.md` to push and open
     the **draft** PR — resolved through `SKILLS_DIR` from step 1, not a
     hardcoded path, so the sibling skills are found wherever the skills
     directory is installed. Read each `SKILL.md` and follow its steps as written
     rather than reimplementing them here. Write the commit message and the PR
     title and body from the per-item results — which skills and tracked files
     moved, and from which `metadata.version` to which — not as a file list.
     Mention any **stale** files in the PR body, since the reviewer is the one
     who decides whether to prune them.

     If either skill is not installed in this repository, or a phase fails
     partway, stop there and report exactly how far the run got: the branch
     name, whether the changes are committed, and whether they are pushed.

10. Report the result as a per-item summary (skills and tracked files together).
    For each item list one of:
    - **updated** — files fetched and written (note how many, and if any nested
      related files were included);
    - **unchanged** — fetched, but identical to what was already on disk;
    - **no-source** — no `metadata.source`, skipped;
    - **unsupported** — non-github.com or a URL that is neither `tree` nor `blob`;
    - **source-missing** — the source directory/file did not exist at that ref;
    - **failed** — an error occurred (include the error).

    Then summarize the whole run: the branch the update is on and the commit
    sha, which files changed (`git show --stat HEAD` is the clearest way to show
    it), and any **stale** files you flagged. Note that the PR is a draft, and
    that `{old}` was left untouched and is no longer checked out. When nothing
    changed, say instead that no branch, commit, or PR was created and that the
    checkout is back on `{old}`.

    Finish with the PR URL as a bare `https://github.com/...` URL on its own
    line, so the terminal makes it clickable — never a PR number or a branch
    name in its place. On an exit with no PR (nothing changed, a download
    failed, the user asked to skip it, or a phase failed), say so in as many words and name the current
    branch, so a missing link is never mistaken for an oversight.
