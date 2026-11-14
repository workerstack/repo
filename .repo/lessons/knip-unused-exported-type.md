---
name: knip-unused-exported-type
paths: ["cli/knip-check.ts","cli/knip-check.constants.ts","cli/**/*.constants.ts"]
hits: 3
last-hit: 2026-11-14
evidence: ["roadmap 8","roadmap 9","plan 222"]
---

# Export a name only when another file imports it

## Mistake
Plans 154 and 156 exported types, and plan 222 two constants, that only their own file used. knip flags unused exports, so `bun repo check` failed in CI. The commit hook does not run knip.

## Fix
Keep the type local in a non-`.types.ts` file, or write it inline on the member that uses it. Run knip through `bun repo check` before ci.
