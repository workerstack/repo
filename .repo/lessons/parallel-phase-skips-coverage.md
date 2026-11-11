---
name: parallel-phase-skips-coverage
paths: ["references/review-loop.md","agents/subagents/implementer-fast.md","agents/subagents/implementer-deep.md"]
hits: 2
last-hit: 2026-11-11
evidence: ["plan 20","roadmap 6"]
---

# Parallel phases pass their tests and still fail the coverage gate

Each parallel implementer ran only its own test file so new branches nobody tested surfaced only at the full suite's 100% gate.

## Mistake
Plan 20 ran three generator phases at once. Each brief said to run its own `vitest run <file>` per `references/review-loop.md` (a parallel implementer never runs the full suite). All three passed and every phase was staged. Then `bun run test` failed the 100% branch threshold on all three modules (76% 93% and 96%). The fix took a second round per phase after the phases were already staged as passed.

## Fix
Every phase brief that writes product code runs its tests with coverage limited to the files it writes for example `bunx vitest run --coverage <test> --coverage.include=<file>` and the phase passes only at the repo's thresholds. The reviewer checks that run before staging. When a branch has no input that reaches it delete it rather than lower the gate.
