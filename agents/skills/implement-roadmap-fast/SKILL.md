---
name: implement-roadmap-fast
description: 'Run a locked .repo/roadmaps-fast roadmap in order, each slice as a fast plan.'
---
# implement-roadmap-fast

`/implement-roadmap-fast {n|path}`. Format: `node_modules/@workerstack/repo/references/fast-roadmap-format.md`. Refuse `status: draft`: say it is not locked and stop. Accept `locked` or `in-progress`.

1. Set frontmatter `status: in-progress` first (Edit the saved file).
2. For each open slice, in order:
   - Run `/write-plan-fast` from the slice line. The lock is the approval.
   - Add a `Location: <abs path the save returned>` line under the slice, indented six spaces (Edit the saved roadmap). Never write a second plan when Location is set.
   - Run `/implement-plan-fast {m}` in this session. Do not stop: the hook does not ask for its block.
   - Tick the slice `[x]` only after its plan is done.
3. Run the Verify boxes and tick each `[x]`. Set `status: done`.

No subagents, no journal, no review. Under `/away` do not ask: decide, log `- decision: {question} → {choice}, because {why}` in an optional trailing `## Previous mistakes` of the fast roadmap, and continue. Stop on a blocker or a failed Verify and say where.
