---
name: new-rule-trips-planted-sources
paths: ["cli/guard-diagnostics.test.ts","cli/scripts/lint-main.test.ts","cli/scripts/lint-plugin.test.ts","cli/scripts/lint-repo-rules.test.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# A new lint rule reports the sources lint-runner tests plant

Adding a rule broke tests that had nothing to do with it.

## Mistake
Plan 150 added a rule and fixed every hit `bun repo lint` showed in the tree. The lint-runner tests (guard-diagnostics, lint-main, lint-plugin) write their own sources into temp dirs and run real oxlint there, expecting exact diagnostics. The new rule reported those planted sources too, so the tests' expected output was wrong and they failed only in the full `bun repo ci`.

## Fix
When a rule is added or widened, run the guard-diagnostics, lint-main and lint-plugin suites before ci. Change a planted source only if the new rule reports it, keeping what the test is about.
