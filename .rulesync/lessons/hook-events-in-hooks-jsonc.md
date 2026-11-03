---
name: hook-events-in-hooks-jsonc
paths: [".rulesync/scripts/hooks-union.mjs",".rulesync/hooks.jsonc"]
hits: 1
last-hit: 2026-11-03
evidence: ["roadmap 1"]
---

# New hook events belong in hooks.jsonc, not the hooks-union overlay

Claude worktree events written by `hooks-union.mjs` broke `rulesync generate --check`.

## Mistake
Plan 30 had `hooks-union.mjs` add `WorktreeCreate`/`WorktreeRemove` to `.claude/settings.json` after rulesync ran. Rulesync replaces the whole `hooks` key from `.rulesync/hooks.jsonc` on every generate, so the check reported the file as stale. A repo's own hook in `settings.json` never survives generate either, which made the plan's "keep a repo's own hook" branch dead code.

## Fix
Declare grunt's hooks in `.rulesync/hooks.jsonc`: shared events under `hooks`, one harness's events under its block (`claudecode.hooks`, using rulesync's camelCase names such as `worktreeCreate`). Keep `hooks-union.mjs` to what rulesync cannot express, plus `checkUnion` needles. After any hook change, run `npm run rulesync:generate` and the `hooks generate --check` test.
