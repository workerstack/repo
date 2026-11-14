---
name: rebase-then-regenerate-before-verify
paths: ["cli/sync/stock-history.json",".repo/lint-baseline.json","dev/stock-history.ts"]
hits: 3
last-hit: 2026-11-12
evidence: ["roadmap 5","roadmap 6","roadmap 8"]
---

# Rebase and regenerate before Verify, not after

## Mistake
Main moves while a slice runs. Verify ran before the rebase, or `bun dev/stock-history.ts` ran before it, so main's CI failed stock-history, and the baseline check failed rows from a rule that landed upstream (roadmap 5).

## Fix
1. Rebase onto main. 2. `bun install`, `bun bin/repo.ts sync`. 3. Verify: ci, e2e, `sync --check`. 4. After a rebase conflict in `cli/sync/stock-history.json`, run `bun dev/stock-history.ts` and stage it; otherwise the commit gate writes and stages it. 5. `bun bin/repo.ts github`, commit. Redo from 1 if main moves.
