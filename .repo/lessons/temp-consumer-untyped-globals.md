---
name: temp-consumer-untyped-globals
paths: ["cli/scripts/lint-plugin.test.ts","cli/guard-diagnostics.test.ts","cli/scripts/turn.test.ts","cli/scripts/lint-main.test.ts","cli/scripts/lint-repo-rules.test.ts"]
hits: 5
last-hit: 2026-11-11
evidence: ["plan 95","plan 97","roadmap 6","plan 150","plan 150"]
---

# A new lint rule or type-aware rule trips the sources lint tests plant

## Mistake
Lint-runner tests plant sources in temp dirs and assert exact diagnostics. A new rule (plan 150), or type-aware rules on a temp consumer with no `@types/node` (plan 95), reported the planted code and failed tests only in full ci.

## Fix
After adding or widening a rule, run guard-diagnostics, lint-main and lint-plugin first. Declare globals a planted file needs (`declare const expect: …`) or drop `typescript(no-unsafe-*)` lines before comparing. Change a planted source only if the rule reports it.
