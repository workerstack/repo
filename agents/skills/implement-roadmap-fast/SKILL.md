---
name: implement-roadmap-fast
description: 'Run a locked .repo/roadmaps-fast roadmap in order, each slice as a fast plan.'
---
# implement-roadmap-fast

`/implement-roadmap-fast {n|path}`. Format: `node_modules/@workerstack/repo/references/fast-roadmap-format.md`. Refuse `status: draft`: say it is not locked and stop. Accept `locked` or `in-progress`.

1. Set frontmatter `status: in-progress` first (Edit the saved file).
2. For each open slice, in order. Adjacent open slices that end `(parallel: …)` form a group and run together below; any other slice runs alone:
   - Run `/write-plan-fast` from the slice line. The lock is the approval. For a group, write every plan first.
   - Add a `Location: <abs path the save returned>` line under the slice, indented six spaces (Edit the saved roadmap). Never write a second plan when Location is set.
   - Alone: run `/implement-plan-fast {m}` in this session. Do not stop: the hook does not ask for its block.
   - Tick the slice `[x]` only after its plan is done.
3. Run the Verify boxes as `node_modules/@workerstack/repo/references/plan-format.md` Verify batching says, and tick each `[x]`. Set `status: done`.

A group runs by its plans' `strategy:`:

- All `free`: spawn one `claude` subagent per plan in one message, each prompt only `/implement-plan-fast <abs plan path> commit only` and the root path. Each works in its own worktree and commits only.
- All `spawn-fast` or `spawn-deep`: run each plan from this session as `/implement-plan-fast` says, sending the implementers of every plan's current step for a round in one message, and commit each as `commit only` does. A claude subagent cannot spawn agents, so these never go to one.
- Mixed, or under `workflow: "pull-request"` (finish opens a pull request and the default branch does not move): run the group's plans one by one, as lone slices.

Then land the group in slice order, one plan at a time, in its worktree:

1. `bun repo slice-files <abs roadmap path> <slice>`. Exit 1 names a file outside the slice's list: move that plan to the end of the group and land the rest first.
2. `git rebase <default branch>`, then `bun repo ci`. Fix a conflict or a red run in that worktree; when it cannot be fixed, set that plan `blocked`, keep its worktree, land the rest, and stop after the group.
3. `cd <root> && bun repo worktree finish <name>`, set the plan `done`, and tick its slice.

On resume, read each group plan's state, not what the last run meant to do: skip a `done` plan, land one whose worktree has a commit past the default branch, and rerun one with no worktree or no commit. Only this session edits the roadmap; each subagent edits only its own plan and worktree.

No journal, no review, and no subagents outside a group. Under `/away` do not ask: decide, log `- decision: {question} → {choice}, because {why}` in an optional trailing `## Previous mistakes` of the fast roadmap, and continue. Stop on a blocker or a failed Verify and say where.
