---
name: no-native-require-of-ts-under-test
paths: ["cli/**/*.ts"]
hits: 1
last-hit: 2026-11-09
evidence: ["plan 21"]
---

# A native require of a local .ts double-counts its coverage

Code that tests import loaded a local .ts through createRequire, and its per-file coverage jumped between runs.

## Mistake
`doctor.ts` and `sync-global-settings.ts` loaded `./check-globals.ts` with `createRequire(import.meta.url)`, to defer smol-toml or to dodge an import cycle. Under vitest that bypasses the transform, so the file and its imports load a second time natively under the same file URL. V8 merges the two records for one URL into wrong line data: `sync-global-settings.ts` measured 57.6% in two runs and 53.9% in a third, against a floor of 57.

## Fix
In code that tests import, never load a local .ts through `createRequire` or a native `require`. Use a static import (an ESM cycle is safe when neither module uses the other's bindings at module scope) or `await import()` when the load must stay lazy. Check a coverage floor by running the full suite three times and comparing the per-file numbers.
