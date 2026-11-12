---
name: knip-unused-exported-type
paths: ["cli/knip-check.ts","cli/knip-check.constants.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# knip fails an exported type nothing imports

Naming a type for a refactor failed `bun repo check` on knip.

## Mistake
Plans 154 and 156 exported new named types (a `HeadersLike` in a `.types.ts` file, aliases next to their functions) that only their own file used. knip reports unused exported types, and check fails. A `.types.ts` file can't simply drop the `export`, because the `types-file` rule forbids unexported types there.

## Fix
Export a type only when another file imports it. Otherwise keep it local in a non-`.types.ts` file, or write it inline on the member that uses it. Run knip (via `bun repo check`) before ci.
