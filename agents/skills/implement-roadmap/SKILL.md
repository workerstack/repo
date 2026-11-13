---
name: implement-roadmap
description: >-
  Run a locked roadmap in order. Use for /implement-roadmap. Writes each missing
  plan, then /implement-plan. Refuses a draft.
---
# implement-roadmap

You run the roadmap in this session. Format: `node_modules/@workerstack/repo/references/roadmap-format.md`.

Refuse `status: draft`. Say it is not locked and stop. Do not write a plan.

Accept `locked` or `in-progress`. Set `in-progress` when you start. Same session. Do not spawn a subagent per slice.

For each open slice, in order:

1. If `Location` is absent, run `/write-plan` from that slice's line: its title and sentence on a pointer roadmap, its Title, Goal and Why on an old-shape one. Research the slice's decisions and Usage there; they go into the plan, not the roadmap. Read the roadmap's `## Previous mistakes` first and put each entry that touches this slice in the plan's Watch-outs. The lock is the approval: do not stop for plan approval. `/write-plan` picks the type and the `commit:` subject. The plan copies the roadmap's `strategy:` unless the slice's scope argues for another (heuristic in `/write-plan`). If it hits a plan-shaping question, stop and leave the roadmap `locked` or `in-progress`.
2. Set `Location` to the absolute plan path `/write-plan` reported. Do not write a second plan when Location is already set.
3. Run `/implement-plan` on that plan. It works in the plan's worktree `{serial}-{name}` and finishes it. Do not stop between slices.
4. Mark the slice `[x]` only after that plan's Verify is done.
5. Read that plan's `## Previous mistakes`. For each entry that changes the Order or a later slice (its sentence, or on an old-shape roadmap its Goal or Why, or a Decision), add `- slice: {what plan N found} → {what changed in the roadmap}` to the roadmap and make that change in the same save. Earlier entries stay.

A failed program Verify adds `- verify: …` to the roadmap. Stop on a blocker, a failed Verify, or a plan-shaping question.

When every slice and Verify are `[x]`, promote before `done`: the roadmap lives in `.tmp/` and is lost with it. For each roadmap entry that will happen again after this program (Write a lesson only for a mistake our normal workflow will hit again on other tasks. A one-time issue stays in the plan's Previous mistakes.), run `bun repo lessons match` on the files involved, then `hit` the matching lesson with `--evidence "roadmap {n}"` or write a new one (`node_modules/@workerstack/repo/references/lessons.md`). Write or hit it inside a worktree (`bun repo worktree add lesson-{slug}`), commit there, and run `cd <root> && bun repo worktree finish lesson-{slug}`. Then set `status: done`.

On a pointer roadmap the slice's why goes into the child plan's Context. On an old-shape roadmap the Why stays on the roadmap. Never add a Why heading to the child plan.
