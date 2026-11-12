---
name: vitest-relative-mock-under-bun
paths: ["**/*.test.ts"]
hits: 1
last-hit: 2026-11-09
evidence: ["plan 22"]
---

# A relative module mock path mocks nothing under bun

Under `bun --bun vitest`, a relative path given to vitest's module mock resolves against an empty importer, so the module is not mocked and the test passes or fails for the wrong reason.

## Mistake
vitest finds the calling file by the stack text ` at Object.mock`; bun prints `at mock`. A module mock of `"./init.ts"` then mocks nothing and raises no error. 8 calls in `cli/main.test.ts`, `cli/scripts/doctor.test.ts` and `dev/sync-pstack-skills.test.ts` were silently inert until the suite ran under bun.

## Fix
`repo/no-module-mocking` now bans vi and jest module mocks (`mock`, `doMock`, `unstable_mockModule`), so the trap cannot recur. Pass the fake through a parameter, an options field or a real stream instead.
