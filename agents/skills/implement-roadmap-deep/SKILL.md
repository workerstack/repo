---
name: implement-roadmap-deep
description: 'Deep: run a locked roadmap in order. Writes each missing plan, then /implement-plan-deep. Refuses a draft. Short one: /implement-roadmap-fast.'
---
# implement-roadmap-deep

You run the roadmap in this session. Format: `node_modules/@workerstack/repo/references/roadmap-format.md`.

Refuse `status: draft`. Say it is not locked and stop. Do not write a plan.

Accept `locked` or `in-progress`. Set `in-progress` when you start, and at every start, a resumed run too, save the roadmap again with `status: in-progress` (a Write of the saved file) so this session's hook records it and a child plan can take its `strategy:`. Same session. Do not spawn a subagent per slice.

For each open slice, in order. A parallel group runs as the section after this list says; any other slice runs alone:

1. If `Location` is absent, run `/write-plan-deep` from that slice's line: its title and sentence on a pointer roadmap, its Title, Goal and Why on an old-shape one. Research the slice's decisions and Usage there; they go into the plan, not the roadmap. Read the roadmap's `## Previous mistakes` first and put each entry that touches this slice in the plan's Watch-outs. The plan's Context holds `Roadmap: <abs roadmap path> slice N` with the slice's why. The lock is the approval: do not stop for plan approval. `/write-plan-deep` picks the type and the `commit:` subject. The plan's `strategy:` is set by the save: the session value, then the roadmap's, then the config. The plan sends `advice:` when the slice's scope argues for another value (heuristic in `/write-plan-deep`). If it hits a plan-shaping question, stop and leave the roadmap `locked` or `in-progress`.
2. Set `Location` to the absolute plan path `/write-plan-deep` reported. Do not write a second plan when Location is already set.
3. Run `/implement-plan-deep` on that plan. It works in the plan's worktree `{serial}-{name}` and finishes it. Do not stop between slices.
4. Mark the slice `[x]` only after that plan's Verify is done.
5. Read that plan's `## Previous mistakes`. For each entry that changes the Order or a later slice (its sentence, or on an old-shape roadmap its Goal or Why, or a Decision), add `- slice: {what plan N found} → {what changed in the roadmap}` to the roadmap and make that change in the same save. Earlier entries stay.

Adjacent open slices that end `(parallel: …)` form a group. Step 1 writes every group plan first, each with `/write-plan-deep … hold review`; then send every group plan's `/review-plan` agent in one message and settle each plan as `/write-plan-deep` says. A group runs by its plans' `strategy:`:

- All `spawn-fast` or `spawn-deep`: run each plan from this session with `/implement-plan-deep <abs plan path> commit only`, sending the implementers of every plan's current round in one message. Each plan keeps its own worktree and journal.
- All `free`, mixed, or under `workflow: "pull-request"` (finish opens a pull request and the default branch does not move): run the plans one by one, each with `commit only`.

Then land the group in slice order, one plan at a time, in its worktree:

1. `bun repo slice-files <abs roadmap path> <slice>`. Exit 1 names a file outside the slice's list: move that plan to the end of the group and land the rest first.
2. `git rebase <default branch>`, then `bun repo ci`. Fix a conflict or a red run in that worktree; when it cannot be fixed, set that plan `blocked`, keep its worktree, land the rest, and stop after the group.
3. `cd <root> && bun repo worktree finish <name>`, set the plan `done`, and tick its slice. Then step 5 for that plan.

On resume, read each group plan's state, not what the last run meant to do: skip a `done` plan, review one with `reviews: 0`, land one whose worktree has a commit past the default branch, and run `/implement-plan-deep <abs plan path> commit only` on the rest, which starts at the first open leaf.

Run the roadmap Verify leaves as `node_modules/@workerstack/repo/references/plan-format.md` Verify batching says.

A failed program Verify adds `- verify: …` to the roadmap. Stop on a blocker, a failed Verify, or a plan-shaping question.

When every slice and Verify are `[x]`, promote before `done`: the roadmap lives in `.tmp/` and is lost with it. For each roadmap entry that will happen again after this program (Write a lesson only for a mistake our normal workflow will hit again on other tasks. A one-time issue stays in the plan's Previous mistakes.), run `bun repo lessons match` on the files involved, then `hit` the matching lesson with `--evidence "roadmap {n}"` or write a new one (`node_modules/@workerstack/repo/references/lessons.md`). Write or hit it inside a worktree (`bun repo worktree add lesson-{slug}`), commit there, and land it the way `AGENTS.md` says (by default `cd <root> && bun repo worktree finish lesson-{slug}`). Then set `status: done`.

On a pointer roadmap the slice's why goes into the child plan's Context. On an old-shape roadmap the Why stays on the roadmap. Never add a Why heading to the child plan.
