---
name: shipped-source-es2022-lib
paths: ["cli/lint/comment-lines.ts","cli/release/consumer.constants.ts","tsconfig/bun.json"]
hits: 4
last-hit: 2026-11-12
evidence: ["plan 71","plan 113","roadmap 6","plan 145"]
---

# Code an export reaches must type-check under ES2022, not ESNext

## Mistake
Consumers type-check the shipped `cli/` source with `target: ES2022`; this repo's `tsconfig/bun.json` uses ESNext. Plan 71's `findLastIndex` passed local ci and failed only in CI's `consumer` job.

## Fix
In files an `exports` subpath reaches, avoid ES2023+ APIs (`findLast`, `findLastIndex`, `toSorted`, `toReversed`, `toSpliced`, `with`, `Object.groupBy`). Before pushing shipped source, run `bun bin/repo.ts release consumer`.
