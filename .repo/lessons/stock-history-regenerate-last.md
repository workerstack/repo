---
name: stock-history-regenerate-last
paths: ["cli/sync/stock-history.json","dev/stock-history.ts"]
hits: 6
last-hit: 2026-11-12
evidence: ["plan 125","plan 126","roadmap 8","roadmap 9","plan 161"]
---

# Run bun dev/stock-history.ts after every other staged change

## Mistake
Plans 124-126 regenerated `cli/sync/stock-history.json` mid-phase, then staged one more stock-file change. The history hashes the index, so `dev/stock-history.test.ts` failed at the final ci.

## Fix
Run `bun dev/stock-history.ts` last, after every other file is staged, then stage `cli/sync/stock-history.json`. Any change after it means running it again.
