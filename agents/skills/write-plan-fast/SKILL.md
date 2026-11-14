---
name: write-plan-fast
description: 'Write a short fast plan under .repo/plans-fast/. Then /implement-plan-fast {n}.'
---
# write-plan-fast

Only when the person asks for a fast plan (`/write-plan-fast` or in words). Never pick it yourself: the default is `/write-plan-deep`.

Persist under `.repo/plans-fast/` via Write (hook runs `cli/scripts/persist-fast-plan.ts`). Format: `node_modules/@workerstack/repo/references/fast-plan-format.md`.

Empty task → ask for a task and stop.

Body's first line is `FAST_PLAN_NAME: <3-6 word name>`, then `commit: type(scope): subject` and `advice:`, `# {slug}`, and `## Goal`, `## Steps`, `## Verify`. Nothing else: no card, Usage, Context, review, principle leaf or lesson. Steps and Verify are flat `N [ ] text` boxes. The whole file, frontmatter included and the `strategy:` and `advice:` lines not counted, is at most 40 lines; work over that is `/write-plan-deep`.

Never write a `strategy:` line: the save sets it from the session value (`/set`, `bun repo set`), then the newest in-progress fast roadmap this session saved, then `agents.defaultStrategy`, then `free`; a line that differs is denied. Send `advice: {free|spawn-fast|spawn-deep} because {reason}` (at most 100 characters) on its own line beside `commit:` with the value the scope argues for: `free` for one file or docs, `spawn-fast` for code across several files, `spawn-deep` for a hook, a gate or hard-to-undo work.

Research until every step is defensible. Ask only what the person alone can answer.

Report the serial N at the absolute path the Write returned, the goal and the top risk. End the reply with the approval block, fenced as code, nothing after it:

```
fast-plan {n} · {s}
  fast-plan {n} advice: {advice}
  i  implement    i free · i fast · i deep
  h  hand off     h free · h fast · h deep
     or reply to revise
```

`{s}` is the strategy in the file. When the file has `advice:`, put its row right under the header; with no advice, no row. The Stop hook names the exact block when yours is off. `i` runs `/implement-plan-fast {n}` in this session with the file's strategy; `i free`, `i fast` and `i deep` write that strategy first and keep it as the session strategy. `h` hands off to a fresh session (`/pickup`), and `h free`, `h fast` and `h deep` write a strategy first; do no work here. Any other reply is feedback: revise the same file and show the block again. On Claude Code the Stop hook may name an approval picker instead: call AskUserQuestion with exactly its input and act on the answer's context; feedback revises the file and stops again.
