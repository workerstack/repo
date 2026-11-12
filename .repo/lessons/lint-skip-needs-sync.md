---
name: lint-skip-needs-sync
paths: ["workerstack.config.ts","cli/sync/oxlint-config.ts","cli/scripts/lint-skips.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# A lint.skip edit shows only after bun repo sync

Hit counts taken right after editing a `lint.skip` entry were the counts from before the edit.

## Mistake
Plan 147 deleted a `lint.skip` entry from `workerstack.config.ts` and ran `bun repo lint` to count the hits it now reported. `bun repo lint` reads the generated `.oxlintrc.json`, not the config, so the skip still applied and the count came back 0. The same happens in reverse when a skip is added.

## Fix
Run `bun repo sync` after every `lint.skip` or rule-option edit, before `bun repo lint`. For a skip-free recount: back up `workerstack.config.ts`, delete the skip, sync, count, then restore the backup and sync again.
