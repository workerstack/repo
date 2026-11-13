---
name: knip-unused-exported-type
paths: ["cli/knip-check.ts","cli/knip-check.constants.ts"]
hits: 2
last-hit: 2026-11-12
evidence: ["roadmap 8","roadmap 9"]
---

# Export a type only when another file imports it

## Mistake
Plans 154 and 156 exported new named types that only their own file used. knip reports unused exported types, so `bun repo check` failed. A `.types.ts` file cannot drop the `export`, because the `types-file` rule forbids unexported types there.

## Fix
Keep the type local in a non-`.types.ts` file, or write it inline on the member that uses it. Run knip through `bun repo check` before ci.
