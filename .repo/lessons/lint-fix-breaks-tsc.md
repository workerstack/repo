---
name: lint-fix-breaks-tsc
paths: ["cli/scripts/turn-steps.ts","cli/scripts/lint-main.ts","cli/sync/oxlint-rules.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 6"]
---

# A lint autofix that oxlint calls safe can still break tsc

oxlint's fixes see one file's syntax and types, not the repo's tsconfig, so a "safe" fix can drop code that `exactOptionalPropertyTypes` or a declared signature still needs.

## Mistake
Roadmap 6 hit this three times. Plan 97's staged turn applied every baselined rule's safe fix to each touched file, and `no-unnecessary-type-assertion` dropped a cast in `cli/scripts/speak.ts` that tsc needs under `exactOptionalPropertyTypes`. Plan 100 saw the same fix drop casts again in `speak.ts` and `presets/vitest.ts`. Plan 102's `no-useless-undefined` fix dropped `undefined` arguments that fill required `T | undefined` parameters, and a sweep's codemod narrowed a value so a later use stopped compiling. Lint passed each time; only tsc caught it.

## Fix
After every autofix pass, safe or dangerous, run both `bunx tsc --noEmit -p tsconfig.json` and `-p tsconfig.src.json` before staging. A fix that keeps breaking tsc gets its options narrowed in `cli/sync/oxlint-rules.ts` (as `no-useless-undefined` takes `checkArguments: false`) or the value's type fixed at the root, never a cast added back. When a codemod narrows a value, name the narrowed value in a const.
