---
name: guard-miss-needs-coverage
paths: ["coverage-floors.json","cli/json.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# A new key guard adds a miss branch the 100% floor counts

Narrowing a lookup safely failed the coverage gate.

## Mistake
Plan 154 replaced unchecked reads with key guards and `?.` lookups. Each one added an `undefined` branch that no test reached, and the per-file 100% floor in `coverage-floors.json` failed in `bun repo ci`. The targeted suites had passed.

## Fix
For each new guard, either send the miss into an exit path that already exists and is tested, or add a test that takes the miss. Never add a coverage ignore. Run targeted vitest with coverage on the touched sources before ci.
