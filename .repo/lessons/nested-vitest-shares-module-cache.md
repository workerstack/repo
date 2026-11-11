---
name: nested-vitest-shares-module-cache
paths: ["cli/coverage.ts","cli/scripts/turn.ts","cli/**/*.test.ts","cli/scripts/__fixtures__/**"]
hits: 1
last-hit: 2026-11-09
evidence: ["plan 44"]
---

# A nested vitest run wipes the outer run's module cache

Vitest 5 keeps a file module cache in `<root>/node_modules/.vitest-cache` and deletes the whole directory at start when the lockfile hash differs from its `_metadata.json`. A nested run in a project that links this repo's dependencies shares that directory and wipes it mid-run.

## Mistake
`cli/coverage.test.ts` and `cli/scripts/__fixtures__/turn-repo.ts` link this checkout's dependency dir into a temp root with no `bun.lock`. The `repo coverage` and `repo turn` runs they spawn saw a different lockfile hash and cleared the cache, so about 1 in 3 full runs failed several files at import with `ENOENT … .vitest-cache/<sha1>`.

## Fix
Every vitest run `repo` spawns passes `NESTED_VITEST_FLAGS` from `cli/nested-vitest-flags.ts` (`--fsModuleCache=false`). The sentinel test in `cli/coverage.test.ts` fails when a nested run deletes a file in the shared cache. A new spawn of vitest uses the same flags.
