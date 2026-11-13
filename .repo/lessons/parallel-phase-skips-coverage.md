---
name: parallel-phase-skips-coverage
paths: ["references/review-loop.md","agents/subagents/implementer.md"]
hits: 3
last-hit: 2026-11-12
evidence: ["plan 20","roadmap 6","plan 126"]
---

# Parallel phases pass their own tests and still fail the 100% floor

## Mistake
Plan 20's three parallel implementers ran only their own test file, all passed and were staged, then the full run failed the 100% branch floor on all three modules and each needed a second round.

## Fix
Each product phase brief runs its tests with coverage on its own files (`bunx vitest run --coverage <test> --coverage.include=<file>`) and passes only at the repo thresholds; the reviewer checks it before staging. Delete an unreachable branch instead of lowering the gate.
