---
name: write-plan-fast
description: 'Write a short fast plan under .repo/plans-fast/. Then /implement-plan-fast {n}.'
---
# write-plan-fast

Only when the person asks for a fast plan (`/write-plan-fast` or in words). Never pick it yourself: the default is `/write-plan`.

Persist under `.repo/plans-fast/` via Write (hook runs `cli/scripts/persist-fast-plan.ts`). Format: `node_modules/@workerstack/repo/references/fast-plan-format.md`.

Empty task → ask for a task and stop.

Body's first line is `FAST_PLAN_NAME: <3-6 word name>`, then `commit: type(scope): subject`, `# {slug}`, and `## Goal`, `## Steps`, `## Verify`. Nothing else: no card, Usage, Context, review, principle leaf, lesson or strategy. Steps and Verify are flat `N [ ] text` boxes. The whole file, frontmatter included, is at most 40 lines; work over that is `/write-plan`.

Research until every step is defensible. Ask only what the person alone can answer.

Report the serial N at the absolute path the Write returned, the goal and the top risk. End the reply with the fast block, fenced as code, nothing after it:

```
fast-plan {n}
  i  implement
  h  hand off
     or reply to revise
```

`i` runs `/implement-plan-fast {n}` in this session. `h` hands off to a fresh session (`/pickup`); do no work here. Any other reply is feedback: revise the same file and show the block again.
