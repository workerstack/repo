---
name: temp-consumer-untyped-globals
paths: ["cli/scripts/lint-plugin.test.ts","cli/guard-diagnostics.test.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["plan 95"]
---

# A temp consumer has no types, so type-aware rules fire on every global

Tests that plant a consumer in a temp dir and run real oxlint or `repo turn` there install no `@types/node` or vitest, so `process`, `expect`, `it` and `vi` are error-typed, and every type-aware unsafe-any rule reports their use.

## Mistake
Plan 95 turned on the correctness and suspicious categories plus `no-unsafe-member-access`, `no-unsafe-return` and `no-unsafe-call`. `cli/scripts/lint-plugin.test.ts` and `cli/guard-diagnostics.test.ts` assert the exact hit list of a planted consumer, and both failed on unsafe-any hits from untyped globals, not on the rules they plant.

## Fix
When a planted file uses a global only for its shape, declare it typed in the planted source (`declare const expect: …`), as `cli/guard-diagnostics.test.ts` does. When the planted files are many and the test asserts each planted rule, drop the `typescript(no-unsafe-*)` lines before comparing, as `cli/scripts/lint-plugin.test.ts` does. Run the full suite after turning on a type-aware rule.
