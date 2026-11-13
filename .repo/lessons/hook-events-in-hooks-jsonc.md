---
name: hook-events-in-hooks-jsonc
paths: ["cli/scripts/hooks-union*.ts","agents/hooks.jsonc","cli/sync/agents/render-hooks.ts"]
hits: 2
last-hit: 2026-11-09
evidence: ["roadmap 1","plan 20"]
---

# Declare hook events in agents/hooks.jsonc, not the hooks-union overlay

## Mistake
Plan 30 had `hooks-union.ts` add worktree events to `.claude/settings.json` after generate. Generate replaces the whole `hooks` key from `agents/hooks.jsonc`, so the check reported the file as stale.

## Fix
Put hooks in `agents/hooks.jsonc`: shared events under `hooks`, one harness's under its block (`claudecode.hooks`, camelCase). Keep `hooks-union.ts` for what `render-hooks.ts` cannot express. After a hook change run `bun bin/repo.ts sync` and `cli/sync/golden.test.ts`.
