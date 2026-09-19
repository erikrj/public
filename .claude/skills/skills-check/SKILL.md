---
name: skills-check
description: Report which installed skills and tracked files are out of date against their authoritative source, without changing anything
allowed-tools: Bash(gh:*), Bash(git:*), Bash(ls:*), Bash(grep:*), Bash(sed:*), Bash(printf:*), Bash(dirname:*), Bash(mktemp:*), Bash(mkdir:*), Bash(cmp:*), Bash(awk:*), Bash(rm:*), Read, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/skills-check
  version: 2026.09.19.1218
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

5. Fetch the source into the temp directory — never over the local copy.

   **An item is a set of files, not a file.** A `blob` item happens to hold one;
   a `tree` item holds every file in the skill directory. Build that set first —
   for each member, the source `blob` path and its `rel` path within the item —
   and also fix `ITEM_ROOT`, the local directory those `rel` paths hang off. The
   two kinds differ only in how the set is built:

   - **`tree` (skill directory).** List the source blobs under `PATH`:
     ```sh
     gh api "repos/$OWNER/$REPO/git/trees/$REF?recursive=1" \
       --jq ".tree[] | select(.type==\"blob\") | .path" \
       | grep -E "^$(printf '%s' "$PATH" | sed 's/[.[\*^$/]/\\&/g')(/|$)"
     ```
     An empty list means the directory is absent at that ref — report
     **source-missing**. Otherwise each listed `blob` contributes
     `rel=${blob#"$PATH"/}`, and `ITEM_ROOT="$skill_dir"`.
   - **`blob` (tracked file).** The set has exactly one member, and **its
     variables must be bound explicitly**:
     ```sh
     blob="$PATH"; rel="${PATH##*/}"; ITEM_ROOT="$(dirname "$REPO_ROOT/$PATH")"
     ```
     The fetch below reads `$blob` and `$rel` for every item of either kind. A
     `blob` item that leaves them unset does not fail loudly — it re-uses
     whatever the previous item's loop left in them, fetching the wrong source
     to the wrong destination, so a tracked file such as
     `.github/copilot-instructions.md` is silently compared against something
     else. A `404` is **source-missing**.

   Then fetch every member of the set:
   ```sh
   mkdir -p "$(dirname "$TMP/$rel")"
   gh api -H "Accept: application/vnd.github.raw" \
     "repos/$OWNER/$REPO/contents/$blob?ref=$REF" > "$TMP/$rel"
   ```

   The `mkdir -p` is load-bearing, not decoration. A skill directory may hold
   nested files (`references/foo.md`), and the redirection cannot create their
   parent — without it the fetch fails for exactly those files, and they are then
   silently absent from the comparison rather than reported as differing.

6. Compare, and classify each item into exactly one status. Compare **content
   first**, then use the version only to explain a difference:

   Compare **every member of the set** from step 5, not one representative file:
   ```sh
   differing=""
   for rel in $rels; do
     cmp -s "$ITEM_ROOT/$rel" "$TMP/$rel" || differing="$differing $rel"
   done
   ```
   `cmp` compares two *files*; it cannot walk a directory. Pointing it at a skill
   directory is an error, and pointing it at that skill's `SKILL.md` alone is
   worse — it succeeds, so a skill whose `SKILL.md` is untouched but whose
   `references/foo.md` changed reports **current** with the file sets matching
   and nothing to draw the eye.

   - `$differing` empty **and** the step-7 file sets match → **current**.
   - Otherwise read `metadata.version` from both sides and compare them as
     **strings**. The stamp lives in one designated file per item — the item's
     own file for a `blob`, `SKILL.md` for a `tree` — so read it from there
     (`meta "$ITEM_ROOT/$stamp_rel" version` against
     `meta "$TMP/$stamp_rel" version`) no matter which member actually differed:

     | Comparison | Status | Means |
     |---|---|---|
     | source > local | **outdated** | the source moved on — but see the local-edit check below before treating that as safe to overwrite |
     | local > source | **ahead** | local edits not yet published — normal in this repository |
     | equal, content differs | **diverged** | same stamp, different bytes: one side changed without bumping |
     | either missing or malformed | **unversioned** | differs, but the direction cannot be established |

     Version stamps are `YYYY.MM.DD.HHMM`, fixed-width and zero-padded, so a
     plain string comparison orders them correctly — the same property that makes
     ISO-8601 timestamps safe to compare as strings. A stamp that does not match
     that shape must be treated as **unversioned** rather than compared anyway;
     an unpadded month (`2026.9.19.0905`) sorts wrongly and would report the
     direction backwards.

   **A version stamp is a claim, not proof.** It orders two copies only if both
   sides were bumped whenever they changed. A local copy edited *without* a bump,
   on a source that later advanced, reads as plain **outdated** — the local edits
   are invisible to the comparison, and recommending `/skills-update` on that
   basis would discard them. So before reporting any item as **outdated**, check
   whether the local copy carries unpublished edits:

   Scope both checks to `ITEM_ROOT` — the **whole skill directory** for a `tree`
   item, the single file for a `blob`. Checking only the stamped file would miss
   an edited `references/foo.md`, and the item would then be reported as a clean
   **outdated** whose recommended update silently overwrites that edit:
   ```sh
   git status --porcelain -- "$ITEM_ROOT"            # uncommitted modifications
   git log --oneline origin/main..HEAD -- "$ITEM_ROOT"   # committed but unpushed
   ```

   If either is non-empty, report the item as **outdated + local edits** instead,
   and recommend a manual reconciliation — never `/skills-update`, which would
   overwrite the local side. Both checks clean is the only case where a plain
   **outdated** may carry the update recommendation, and even then say that the
   update overwrites local bytes, so an edit made outside git's view is the
   user's to rule out.

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

   Order it usefully: **diverged** and **outdated + local edits** first — the two
   where an unguarded `/skills-update` loses work — then plain **outdated**, then
   **missing-files** / **stale**, then the problem statuses (**failed**,
   **source-missing**, **unsupported**, **no-source**), and **current** and
   **ahead** last — those need no action and should not lead.

   End with the concrete next step, and say plainly that **nothing was fetched
   into the working tree, nothing was changed, and nothing was committed**:
   - anything **outdated** (local-edit check clean) → `/skills-update`, then
     review the result and commit — noting that it overwrote the local bytes;
   - anything **outdated + local edits** → reconcile by hand first; running
     `/skills-update` would discard the unpublished local side;
   - anything **ahead** → the local edits are unpublished; open a PR from here;
   - anything **diverged** → resolve it by hand before running `/skills-update`,
     which would otherwise discard whichever side is local.

   If every item is **current**, say so explicitly and give the number of items
   checked. "Everything is up to date" is only worth reading when it is clear
   what was counted.
