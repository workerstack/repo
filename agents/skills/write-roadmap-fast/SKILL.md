---
name: write-roadmap-fast
description: 'Write a short fast roadmap under .repo/roadmaps-fast/. Then /implement-roadmap-fast {n}.'
---
# write-roadmap-fast

Only when the person asks for a fast roadmap (`/write-roadmap-fast` or in words). Never pick it yourself: the default is `/write-roadmap-deep`.

Persist under `.repo/roadmaps-fast/` via Write (hook runs `cli/scripts/persist-fast-roadmap.ts`). Format: `node_modules/@workerstack/repo/references/fast-roadmap-format.md`.

Empty task → ask for a task and stop. Fewer than two slices is `/write-plan-fast`: say so and stop; write no file.

Body's first line is `FAST_ROADMAP_NAME: <3-6 word name>`, then `advice:`, `# {slug}`, `## Order` and `## Verify`. Nothing else: no card, review, Usage or Context. Order is `N [ ] title: sentence` slices, two or more. Verify is flat `N [ ]` boxes numbered after the slices. The file, frontmatter included and `Location:`, `strategy:` and `advice:` lines not counted, is at most 20 lines; a bigger program is `/write-roadmap-deep`.

Never write a `strategy:` line: the save sets it from the session value (`/set`, `bun repo set`), then `agents.defaultStrategy`, then `free`; a line that differs is denied. Send `advice: {free|spawn-fast|spawn-deep} because {reason}` (at most 100 characters) on its own line right after the name line with the value the scope argues for: `free` for one file or docs, `spawn-fast` for code across several files, `spawn-deep` for a hook, a gate or hard-to-undo work. Each slice's fast plan takes the fast roadmap's strategy unless the session has one.

Research until every slice is defensible. Ask only what the person alone can answer.

When adjacent slices change disjoint paths and need nothing from each other, end each slice line with `(parallel: <path>, …)` listing every path its plan changes (files, folders ending `/`, or globs), so the runner can run them at once.

Report the serial N at the absolute path the Write returned, the slice titles in order and the top risk. On Claude Code outside away, print no block: end the reply after the report, and the Stop hook names the approval picker. Call AskUserQuestion with exactly its input and act on the answer's context. Everywhere else, end the reply with the approval block, fenced as code, nothing after it:

```
fast-roadmap {n} · {s}
  fast-roadmap {n} advice: {advice}
  i  implement    i free · i fast · i deep
  h  hand off     h free · h fast · h deep
     or reply to revise
```

`{s}` is the strategy in the file. When the file has `advice:`, put its row right under the header; with no advice, no row. The Stop hook names the exact block when yours is off. `i` sets `status: locked` on the same file, then runs `/implement-roadmap-fast {n}` in this session with the file's strategy; `i free`, `i fast` and `i deep` write that strategy first and keep it as the session strategy. `h` hands off to a fresh session (`/pickup`), and `h free`, `h fast` and `h deep` write a strategy first; do no work here. Any other reply is feedback: revise the same file and show the block again. A picker answer that is no option's label is feedback too.
