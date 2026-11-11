---
name: ci-shard-margin-in-count
paths: ["cli/sync/release.constants.ts","cli/sync/release-shards.ts","cli/scripts/ci-merge.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 5"]
---

# One CI run's shard times are not the shard's time

Shard counts sized from one run's times put jobs past the 5-minute target on the next run.

## Mistake
GitHub runner speed swings the same shard's files by about 1.4x between runs (Windows 190s then 132s, macOS 35s to 137s). Vitest also assigns files to shards by path hash, not by time. A count that fit one run's times put Windows test 5/5 at 307-316s on a slow runner. Separately, a floor comparison ran with one failing test: vitest skips the coverage floors of a run that has a failed test, but `--merge-reports` checks them anyway, so the two floor lists differed (roadmap 5, plans 99, 105 and 110).

## Fix
- **Shard counts:** size them so the slowest shard of a slow run, about 1.4x the measured time, stays under the target. The margin goes in the count, not in hoping for a fast runner.
- **Proof:** take two dispatched runs and record each job's limiter.
- **Floor comparisons:** compare an unsharded run's floor list with the merged one only after every test passes in both.
