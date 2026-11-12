---
name: stock-history-regenerate-last
paths: ["cli/sync/stock-history.json","dev/stock-history.ts"]
hits: 4
last-hit: 2026-11-12
evidence: ["plan 124","plan 125","plan 126","roadmap 8"]
---

# Stock history goes stale after any later fix

A fix staged after `bun dev/stock-history.ts` ran left the history behind and `bun repo ci` failed its stock-history test.

## Mistake
Plans 124 125 and 126 each regenerated `cli/sync/stock-history.json` mid-phase then staged one more change to a stock file (a test a skill a hand edit). The history hashes the index so `dev/stock-history.test.ts` failed at the final `bun repo ci` with "stock files changed: run `bun dev/stock-history.ts`".

## Fix
Run `bun dev/stock-history.ts` as the very last step before `bun repo ci` after every other file is staged and stage its output. Any change after it means running it again.
