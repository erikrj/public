# Agent Instructions

The authoritative coding and review rules for this repository live in
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).

**Before writing, modifying, or reviewing any code in this repository, read
`.github/copilot-instructions.md` and follow every rule it defines.** Each rule
carries a code (e.g. `TS-001`, `GEN-005`); treat every rule as required unless
its own text uses "should" or "may". When your change relates to a rule, comply
with it and cite the rule code in your explanation.

That file is the single source of truth for repository conventions — this file
only points to it, so that all agents (Claude, Copilot, and others) apply the
same rules.

Note **GEN-005**: agent skills under `.claude/skills/` and
`.github/copilot-instructions.md` itself are distributed copies synced from an
upstream `metadata.source`. Do not edit those files locally — make changes in
their authoritative source and re-sync.
