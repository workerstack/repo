---
name: local-ci-load-hides-failures
paths: ["cli/scripts/ci.ts","cli/scripts/ci-tests.ts","cli/scripts/doctor-*.test.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 5"]
---

# A loaded local ci hides real failures and makes fake ones

A local `repo ci` showed failures that were noise, and hid the one that broke GitHub CI.

## Mistake
Parallel sessions push the load average to 60. Under that load, 5s tests time out locally. That noise hid two real failures:
- **A missed coverage floor.** Plan 96's per-file floor miss on `cli/init-git.ts` failed GitHub's Ubuntu job, not the local run.
- **A tight wall-clock bound.** A doctor row allowed 800ms; a Windows runner took 806ms (roadmap 5, plans 96 and 110).

## Fix
- **Before calling a local failure real:** rerun each timed-out file alone.
- **Rerun until clean:** rerun the whole ci until it passes before trusting it. Do not wave a red file through as load.
- **Timing rows:** assert a ratio with a wide margin (for example, parallel under 2x one delay, with a long delay), never a tight absolute bound in milliseconds.
