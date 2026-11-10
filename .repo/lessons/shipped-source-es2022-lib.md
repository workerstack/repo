---
name: shipped-source-es2022-lib
paths: ["cli/lint/comment-lines.ts","cli/release/consumer.constants.ts","tsconfig/bun.json"]
hits: 1
last-hit: 2026-11-10
evidence: ["plan 71"]
---

# Code an export reaches must type-check under ES2022, but this repo checks it with ESNext

The package ships its `cli/` TypeScript source. `repo release consumer` type-checks an `import type` of every `exports` subpath, and so every file those subpaths reach (`cli/config.ts`, `cli/lint/index.ts` and their imports), in a temp project with `target: ES2022` and the default lib, as a consumer without this repo's presets would. This repo's own typecheck uses `tsconfig/bun.json`, whose `lib` is `ESNext`. So an ES2023-or-later API passes `bun repo ci` locally and fails only in CI's `consumer` job.

## Mistake
Plan 71 used `Array.prototype.findLastIndex` (ES2023) in `cli/lint/comment-lines.ts`. Local ci was green; the side branch's `consumer` job failed with `Property 'findLastIndex' does not exist on type 'readonly string[]'`.

## Fix
In a file an `exports` subpath reaches, write against ES2022: no `findLast`, `findLastIndex`, `toSorted`, `toReversed`, `toSpliced`, `with`, `Object.groupBy` or `Map.groupBy`. Files only `bin/repo.ts` runs are not type-checked by consumers. Before pushing a change to shipped source, run `bun bin/repo.ts release consumer` from the worktree, which runs the same check CI's `consumer` job runs.
