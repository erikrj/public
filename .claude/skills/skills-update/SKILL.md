---
name: skills-update
description: Update every installed skill and its related files from each skill's authoritative source URL in its metadata
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(mkdir:*), Bash(git:*), Read, Write, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/skills-update
  version: 2026.07.15.1412
---

Refresh every installed skill from its **authoritative source**. Each `SKILL.md`
carries a `metadata.source` URL — a GitHub tree URL pointing at the directory the
skill was published from. This skill walks every installed skill, re-downloads
the **entire** source directory for each (the `SKILL.md` **and** all related
files — references, scripts, assets, nested folders), and overwrites the local
copies so they match the source exactly.

This skill only writes files into the skills tree — it does **not** commit, push,
or touch git history. Review the resulting diff yourself and commit when happy.

**Update every skill, not a subset.** Invoking this skill means refresh all
installed skills that declare a source. Do not pick and choose. If the user names
specific skills in the same request, limit to those; otherwise do them all.

## Assumptions & guards

- Requires an authenticated GitHub CLI (`gh auth status`). If `gh` is not
  authenticated, stop and tell the user to run `gh auth login`.
- Only `github.com` tree URLs are supported. If a skill's `source` points at a
  different host (or is a non-`/tree/` URL), skip it and report it as
  **unsupported** — do not guess how to fetch it.
- The fetch is **authoritative-wins**: local files are overwritten with the source
  version. Files that exist locally but are **absent from the source** are **not**
  deleted automatically — they are reported as **stale** so the user can decide.

## Steps

1. Locate the skills directory. This skill lives at
   `<SKILLS_DIR>/skills-update/SKILL.md`, so `SKILLS_DIR` is the parent of this
   skill's own directory — the directory that holds every `<name>/SKILL.md`. Use
   the skill's base directory to resolve it; do not hardcode a path.

2. Enumerate the installed skills — every immediate subdirectory of `SKILLS_DIR`
   that contains a `SKILL.md`:
   ```sh
   ls -d "$SKILLS_DIR"/*/SKILL.md
   ```

3. For each `SKILL.md`, extract its `metadata.source`. It is the `source:` line
   nested under the `metadata:` key in the YAML frontmatter:
   ```sh
   src=$(awk '
     /^metadata:/      {inmeta=1; next}
     inmeta && /^[^[:space:]]/ {inmeta=0}
     inmeta && /^[[:space:]]+source:[[:space:]]/ {
       sub(/^[[:space:]]+source:[[:space:]]*/, ""); print; exit
     }' "$skill_md")
   ```
   - If there is no `source`, skip the skill and report it as **no-source**.

4. Parse the GitHub tree URL. The form is
   `https://github.com/<OWNER>/<REPO>/tree/<REF>/<PATH...>`. Split on `/`:
   `OWNER` and `REPO` are the two segments after `github.com`, the segment after
   `tree` is `REF`, and everything after that is `PATH` (the source directory,
   e.g. `.claude/skills/branch-clean`). Assume `REF` is a **single** segment
   (e.g. `main`); if the branch name itself contains slashes the parse is
   ambiguous — in that case skip and report it as **unsupported**.

5. List every file under the source directory in one call, using the recursive
   Git-tree API, then keep only the blobs under `PATH`:
   ```sh
   gh api "repos/$OWNER/$REPO/git/trees/$REF?recursive=1" \
     --jq ".tree[] | select(.type==\"blob\") | .path" \
     | grep -E "^$(printf '%s' "$PATH" | sed 's/[.[\*^$/]/\\&/g')(/|$)"
   ```
   - An empty list means the source directory does not exist at that ref — report
     the skill as **source-missing** and move on (do not delete anything locally).

6. For each source blob path, compute its path **relative** to `PATH` (strip the
   `PATH/` prefix), and download the raw bytes to the matching location inside the
   local skill directory, creating parent directories as needed:
   ```sh
   rel=${blob#"$PATH"/}
   dest="$skill_dir/$rel"
   mkdir -p "$(dirname "$dest")"
   gh api -H "Accept: application/vnd.github.raw" \
     "repos/$OWNER/$REPO/contents/$blob?ref=$REF" > "$dest"
   ```
   Write the file **exactly** as fetched — do not reformat, re-wrap, or "fix" the
   content. The source is authoritative.

7. After updating a skill, detect **stale** local files — files under the local
   skill directory that were **not** in the source blob list. Report them; do
   **not** delete them unless the user asks you to prune. (A common stale file is
   an intentional local rename or a local-only note.)

8. Move to the next skill and repeat. Note two things while iterating:
   - **Self-update.** If `skills-update` itself is refreshed, its `SKILL.md` is
     rewritten on disk mid-run. The instructions already loaded for *this* run are
     unaffected; the new version takes effect next time.
   - Keep going if one skill fails (network error, missing source) — collect the
     failure and continue so one bad source does not abort the whole update.

9. Report the result as a per-skill summary. For each skill list one of:
   - **updated** — files fetched and written (note how many, and if any nested
     related files were included);
   - **unchanged** — fetched, but identical to what was already on disk;
   - **no-source** — no `metadata.source`, skipped;
   - **unsupported** — non-github.com or unparseable source, skipped;
   - **source-missing** — the source directory did not exist at that ref;
   - **failed** — an error occurred (include the error).

   Then summarize the whole run: which files changed (a `git status --short` /
   `git diff --stat` on the skills tree is the clearest way to show it), any
   **stale** files you flagged, and a reminder that **nothing was committed or
   pushed** — the user should review the diff and commit when satisfied.
