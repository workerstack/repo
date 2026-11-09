---
name: hook-events-in-hooks-jsonc
paths: [".rulesync/scripts/hooks-union.ts",".rulesync/hooks.jsonc","cli/sync/agents/hooks.ts"]
hits: 2
last-hit: 2026-11-09
evidence: ["roadmap 1","plan 20"]
---

# New hook events belong in hooks.jsonc, not the hooks-union overlay

Claude worktree events written by `hooks-union.ts` broke `rulesync generate --check`.

## Mistake
Plan 30 had `hooks-union.ts` add `WorktreeCreate`/`WorktreeRemove` to `.claude/settings.json` after rulesync ran. Rulesync replaces the whole `hooks` key from `.rulesync/hooks.jsonc` on every generate, so the check reported the file as stale. A repo's own hook in `settings.json` never survives generate either, which made the plan's "keep a repo's own hook" branch dead code.

## Fix
Declare repo's hooks in `.rulesync/hooks.jsonc`: shared events under `hooks`, one harness's events under its block (`claudecode.hooks`, using camelCase names such as `worktreeCreate`). Keep `hooks-union.ts` to what the generator (`cli/sync/agents/hooks.ts`) cannot express, plus `checkUnion` needles. After any hook change, run `bun bin/repo.ts sync` and `cli/sync/golden.test.ts`.
