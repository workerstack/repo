---
name: write-roadmap-fast
description: 'Write a short fast roadmap under .repo/roadmaps-fast/. Then /implement-roadmap-fast {n}.'
---
# write-roadmap-fast

Only when the person asks for a fast roadmap (`/write-roadmap-fast` or in words). Never pick it yourself: the default is `/write-roadmap`.

Persist under `.repo/roadmaps-fast/` via Write (hook runs `cli/scripts/persist-fast-roadmap.ts`). Format: `node_modules/@workerstack/repo/references/fast-roadmap-format.md`.

Empty task → ask for a task and stop. Fewer than two slices is `/write-plan-fast`: say so and stop; write no file.

Body's first line is `FAST_ROADMAP_NAME: <3-6 word name>`, then `# {slug}`, `## Order` and `## Verify`. Nothing else: no card, strategy, review, Usage or Context. Order is `N [ ] title: sentence` slices, two or more. Verify is flat `N [ ]` boxes numbered after the slices. The file, frontmatter included and `Location:` lines not counted, is at most 20 lines; a bigger program is `/write-roadmap`.

Research until every slice is defensible. Ask only what the person alone can answer.

Report the serial N at the absolute path the Write returned, the slice titles in order and the top risk. End the reply with the fast block, fenced as code, nothing after it:

```
fast-roadmap {n}
  i  implement
  h  hand off
     or reply to revise
```

`i` sets `status: locked` on the same file, then runs `/implement-roadmap-fast {n}` in this session. `h` hands off to a fresh session (`/pickup`); do no work here. Any other reply is feedback: revise the same file and show the block again.
