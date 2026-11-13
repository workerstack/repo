---
name: lint-fix-breaks-tsc
paths: ["cli/scripts/turn-steps.ts","cli/scripts/lint-main.ts","cli/sync/oxlint-rules.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 6"]
---

# Run tsc after every lint autofix; a safe fix can still break types

## Mistake
oxlint autofixes see one file, not the tsconfig. In roadmap 6, `no-unnecessary-type-assertion` and `no-useless-undefined` fixes dropped casts and `undefined` arguments that `exactOptionalPropertyTypes` needs. Lint passed; only tsc failed.

## Fix
After each autofix pass run `bunx tsc --noEmit -p tsconfig.json` and `-p tsconfig.src.json` before staging. If a fix keeps breaking tsc, narrow its options in `cli/sync/oxlint-rules.ts` or fix the type at the root. Never add the cast back.
