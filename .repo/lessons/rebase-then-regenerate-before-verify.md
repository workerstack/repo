---
name: rebase-then-regenerate-before-verify
paths: ["cli/sync/stock-history.json",".repo/lint-baseline.json","dev/stock-history.ts"]
hits: 2
last-hit: 2026-11-11
evidence: ["roadmap 5","roadmap 6"]
---

# Generated tables go stale on the rebase before landing

Main moved mid-slice, and the work landed with stale generated files or new lint debt.

## Mistake
Other sessions push to main while a slice runs, bringing deps, lint rules and files. Verify ran before the rebase, or `bun dev/stock-history.ts` ran before it. After `finish` rebased, main's CI failed `dev/stock-history.test.ts` (7f2f8ca fixed it). The baseline check compares against main's tip, so a rule that landed upstream failed rows the slice never touched (roadmap 5, slices 6-8 and 11).

## Fix
Use this order, and redo it from the rebase whenever main moves again before the commit:
1. Rebase onto main.
2. `bun install`, then `bun bin/repo.ts sync`.
3. Verify: ci, e2e, `sync --check`, and `lint --baseline` lowering only.
4. Stage, then run `bun dev/stock-history.ts`, then stage again.
5. `bun bin/repo.ts github`, then commit.
