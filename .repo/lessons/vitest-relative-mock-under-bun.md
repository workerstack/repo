---
name: vitest-relative-mock-under-bun
paths: ["**/*.test.ts"]
hits: 1
last-hit: 2026-11-09
evidence: ["plan 22"]
---

# A relative vi.mock path mocks nothing under bun

Under `bun --bun vitest`, a relative path in `vi.mock` or `vi.doMock` resolves against an empty importer, so the module is not mocked and the test passes or fails for the wrong reason.

## Mistake
vitest finds the calling file by the stack text ` at Object.mock`; bun prints `at mock`. A call like `vi.mock("./init.ts", …)` then mocks nothing and raises no error. 8 calls in `cli/main.test.ts`, `cli/scripts/doctor.test.ts` and `dev/sync-pstack-skills.test.ts` were silently inert until the suite ran under bun.

## Fix
Pass `new URL("<relative>", import.meta.url).href` as the first argument (`..` works too). A bare package or `node:` specifier is fine as written. `dev/vi-mock-paths.test.ts` fails on any other spelling in a tracked test, for `vi.mock`, `doMock`, `unmock`, `doUnmock` and `importActual`.
