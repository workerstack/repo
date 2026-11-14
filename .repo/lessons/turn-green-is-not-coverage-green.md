---
name: turn-green-is-not-coverage-green
paths: ["cli/**/*.ts","coverage-floors.json","cli/json.ts"]
hits: 7
last-hit: 2026-11-14
evidence: ["plan 154","plan 154","plan 235","plan 237","plan 239"]
---

# A green turn still misses the 100% coverage floor

## Mistake
`repo turn` runs tests without coverage. Plan 149's new default io reader and error branch, and plan 154's new guard misses, passed turn and then failed `bun repo ci`. A spawned child does not count toward vitest coverage.

## Fix
Give each new branch and default its own in-process test, or send a miss into an already tested exit. Build defaults from covered readers, never a fresh lambda. Never add a coverage ignore. Run `bun repo ci` or vitest coverage on changed files before the commit.
