---
name: skills-check
description: Report which installed skills and tracked files are out of date against their authoritative source, without changing anything
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(git:*), Bash(mktemp:*), Bash(mkdir:*), Bash(diff:*), Bash(cmp:*), Bash(awk:*), Bash(rm:*), Read, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/skills-check
  version: 2026.09.19.0905
---

Report how every installed skill — **and** the repository's other tracked
distributed files — compares to its **authoritative source**, and change
nothing. This is the read-only counterpart of `skills-update`: it answers
*"does anything need updating, and in which direction?"* so the answer can be
had without overwriting a working tree first.

`skills-update` is authoritative-wins: it overwrites local copies with the
source. That is the right behaviour downstream and the wrong way to *find out*
whether an update is needed, because a local edit that has not been published
yet is indistinguishable from a stale copy once it has been overwritten. This
skill compares first and writes nothing, so the local side survives to be
looked at.

**Check everything tracked, not a subset.** Invoking this skill means compare
all installed skills that declare a source **and** every tracked file. If the
user names specific items in the same request, limit to those; otherwise do
them all.

## Assumptions & guards

- Requires an authenticated GitHub CLI (`gh auth status`). If `gh` is not
  authenticated, stop and tell the user to run `gh auth login`.
- Only `github.com` URLs are supported — a `/tree/` URL for a skill directory or
  a `/blob/` URL for a tracked file. Any other host, or a URL that is neither,
  is reported **unsupported**; do not guess how to fetch it.
- **Never write into the working tree.** Every fetched file goes to a temporary
  directory (`mktemp -d`) and is compared from there. Do not "just run
  `skills-update` and read the diff" — that destroys the local side, which is
  exactly what this skill exists to preserve. Remove the temp directory when
  done.
- **This repository is the source for its own skills.** Run here, `ahead` and
  `current` are the expected results and `outdated` would be the surprise —
  a local edit is how a skill is meant to change (**GEN-005**). Run in a
  downstream repository the polarity flips: `outdated` is routine and `ahead`
  means someone edited a copy in place, which **GEN-005** forbids. Say which
  situation the run is in rather than presenting a bare status list.

## Steps

1. Locate the skills directory and the repo root, exactly as `skills-update`
   does. This skill lives at `<SKILLS_DIR>/skills-check/SKILL.md`, so
   `SKILLS_DIR` is the parent of this skill's own directory. Use the skill's
   base directory to resolve it; do not hardcode a path. Resolve the repository
   root too (`git rev-parse --show-toplevel`) — tracked files are addressed
   relative to it.

2. Build the list of tracked items, identically to `skills-update`:
   - **Skills** — every immediate subdirectory of `SKILLS_DIR` holding a
     `SKILL.md`:
     ```sh
     ls -d "$SKILLS_DIR"/*/SKILL.md
     ```
   - **Tracked files** — standalone files carrying their own `metadata.source`
     frontmatter that are not a skill's `SKILL.md`:
     - `<repo-root>/.github/copilot-instructions.md`
     - `<SKILLS_DIR>/ERIKRJ_SKILLS_README.md`

     Include one only if it exists locally; note any that are missing. Keep this
     list in step with `skills-update`'s — the two must check and update the same
     set, or a file silently escapes one of them.

3. Extract each item's `metadata.source` — the `source:` line nested under
   `metadata:` in the YAML frontmatter. Both this and the `version` read in
   step 6 want the same parse, so take the key as a parameter rather than
   keeping two near-identical copies of the awk:
   ```sh
   meta() {  # meta <file> <key>
     awk -v k="$2" '
       /^metadata:/ {inmeta=1; next}
       inmeta && /^[^[:space:]]/ {inmeta=0}
       inmeta && $0 ~ "^[[:space:]]+" k ":[[:space:]]" {
         sub("^[[:space:]]+" k ":[[:space:]]*", ""); print; exit
       }' "$1"
   }
   src=$(meta "$skill_md" source)
   ```
   The `inmeta` guard matters: it stops the match at the end of the `metadata:`
   block, so a `source:` or `version:` appearing later in the body — quoted in
   prose, or inside a fenced example — cannot be picked up instead.

   No `source` → report **no-source** and move on.

4. Parse the URL and note its **kind**, as `skills-update` does. Split on `/`:
   `OWNER` and `REPO` follow `github.com`, the next segment is the kind (`tree`
   or `blob`), then `REF`, then `PATH`. A `REF` containing slashes is ambiguous
   to parse — report **unsupported**.

5. Fetch the source into the temp directory — never over the local copy:

   - **`tree` (skill directory).** List the source blobs under `PATH`:
     ```sh
     gh api "repos/$OWNER/$REPO/git/trees/$REF?recursive=1" \
       --jq ".tree[] | select(.type==\"blob\") | .path" \
       | grep -E "^$(printf '%s' "$PATH" | sed 's/[.[\*^$/]/\\&/g')(/|$)"
     ```
     An empty list means the directory is absent at that ref — report
     **source-missing**. Otherwise fetch each blob to `$TMP/<rel>`, where `rel`
     is its path relative to `PATH`.
   - **`blob` (tracked file).** Fetch the one file to `$TMP/<basename>`. A `404`
     is **source-missing**.

   ```sh
   gh api -H "Accept: application/vnd.github.raw" \
     "repos/$OWNER/$REPO/contents/$blob?ref=$REF" > "$TMP/$rel"
   ```

6. Compare, and classify each item into exactly one status. Compare **content
   first**, then use the version only to explain a difference:

   ```sh
   cmp -s "$local" "$fetched"    # exit 0 = byte-identical
   ```

   - Byte-identical (and, for a skill, the file sets match) → **current**.
   - Otherwise read `metadata.version` from both sides with the step-3 helper —
     `meta "$local" version` and `meta "$fetched" version` — and compare them as
     **strings**:

     | Comparison | Status | Means |
     |---|---|---|
     | source > local | **outdated** | the source moved on; `/skills-update` will bring it forward |
     | local > source | **ahead** | local edits not yet published — normal in this repository |
     | equal, content differs | **diverged** | same stamp, different bytes: one side changed without bumping |
     | either missing or malformed | **unversioned** | differs, but the direction cannot be established |

     Version stamps are `YYYY.MM.DD.HHMM`, fixed-width and zero-padded, so a
     plain string comparison orders them correctly — the same property that makes
     ISO-8601 timestamps safe to compare as strings. A stamp that does not match
     that shape must be treated as **unversioned** rather than compared anyway;
     an unpadded month (`2026.9.19.0905`) sorts wrongly and would report the
     direction backwards.

   **diverged** is the one worth stopping on. It means two copies carry the same
   version and different content, so every downstream consumer that trusts the
   stamp is now wrong about what it has. Name the differing files and say which
   side you believe is newer and why, rather than filing it alongside the
   routine statuses.

7. For a **skill**, also compare the file sets, since a skill is a directory:
   - in the source, absent locally → **missing-files** (an update would add them)
   - local, absent from the source → **stale** (the same files `skills-update`
     reports and does not delete)

   Either makes the item differ even when every shared file is identical.

8. Keep going if one item fails — a network error or a missing source is a
   per-item result, not a reason to abandon the run. Collect it as **failed**
   with its error and continue.

9. Remove the temp directory, then report. Lead with the answer to the question
   that was actually asked — *does anything need updating?* — then the per-item
   table:

   | Item | Status | Detail |
   |---|---|---|
   | `branch-clean` | current | — |
   | `.github/copilot-instructions.md` | outdated | source `2026.09.19.0834` > local `2026.09.13.0840` |

   Order it usefully: **diverged** first, then **outdated**, then
   **missing-files** / **stale**, then the problem statuses (**failed**,
   **source-missing**, **unsupported**, **no-source**), and **current** and
   **ahead** last — those need no action and should not lead.

   End with the concrete next step, and say plainly that **nothing was fetched
   into the working tree, nothing was changed, and nothing was committed**:
   - anything **outdated** → `/skills-update`, then review the diff and commit;
   - anything **ahead** → the local edits are unpublished; open a PR from here;
   - anything **diverged** → resolve it by hand before running `/skills-update`,
     which would otherwise discard whichever side is local.

   If every item is **current**, say so explicitly and give the number of items
   checked. "Everything is up to date" is only worth reading when it is clear
   what was counted.
