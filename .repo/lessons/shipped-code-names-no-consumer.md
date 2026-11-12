---
name: shipped-code-names-no-consumer
paths: ["cli/scripts/env-command.ts", "cli/env/define.ts", "references/exports.md", "agents/skills/review-plan/SKILL.md", "agents/skills/review-roadmap/SKILL.md"]
hits: 1
last-hit: 2026-11-12
evidence: ["plan 153"]
---

# The package ships code that knows one consumer's private repo

A feature built for one consumer's need shipped that consumer's private API, project names and home paths inside the published package.

## Mistake
Roadmap 7 put "a migrate codemod for consumers (createScriptEnv/secret → defineEnv/sealed)" in a slice's scope. createScriptEnv was one private repo's own helper, so `bun repo env migrate` shipped 2311 lines that only that repo could use, and every review checked the plans against that scope without asking whether it belonged in the package. The same work leaked the repo's project name into tests and docs, and real home paths into fixtures and references (plan 153 deleted them).

## Fix
The package names no other repo's API, files, project, paths or values: a consumer's own migration lives and runs in that consumer, and examples and fixtures use a made-up name (acme, shop) and a generic home (`/home/dev`). `/review-plan` item 11 and `/review-roadmap` item 9 flag a scope that ships one consumer's private API before approval.
