---
name: local-ci-load-hides-failures
paths: ["cli/scripts/ci.ts","cli/scripts/ci-tests.ts","cli/scripts/doctor-*.test.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 5"]
---

# A loaded local ci hides real failures and makes fake ones

## Mistake
Parallel sessions push the load average to 60, so 5s tests time out locally. That noise hid a per-file coverage miss that failed GitHub (plan 96) and a doctor row with an 800ms bound that a Windows runner took 806ms to pass.

## Fix
Rerun each timed-out file alone, then rerun the whole ci until it is clean; do not wave a red file through as load. Assert timing rows as a ratio with a wide margin, never a tight bound in milliseconds.
