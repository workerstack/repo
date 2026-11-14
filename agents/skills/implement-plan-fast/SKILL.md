---
name: implement-plan-fast
description: 'Execute a .repo/plans-fast checklist inline in this session.'
---
# implement-plan-fast

`/implement-plan-fast {n|path} [commit only]`. Do the plan here, with no journal.

`commit only` (a runner's subagent prompt says it): at step 5 run the `/commit` diff pass and `git commit` with the `commit:` subject in the worktree, never `worktree finish`, and leave `status: in-progress`; the runner checks, lands and sets `done`. End the reply with `worktree: <abs path>` and `commit: <short sha>` on their own lines.

strategy spawn-fast or spawn-deep: read node_modules/@workerstack/repo/references/review-loop.md first; each step goes to an implementer as a phase does, and a group of `(parallel: …)` steps spawns its implementers in one message, then `bun repo phase-files <fast plan path> <steps>` (the path, never the serial) and the full suite. free: no subagents; steps run in order; ignore this line. Empty arg: the unique in-progress, else unique ready fast plan, else list serials.

1. Set frontmatter `status: in-progress` (Edit the saved file).
2. `bun repo worktree add fast-{serial}-{name}`. Edit and test only there.
3. Per box, in order: for a behavior fix write the failing test and see it fail first, make the change, run the nearest tests, then tick the box (Edit the saved file).
4. Run the Verify boxes as `node_modules/@workerstack/repo/references/plan-format.md` Verify batching says. Set `status: done` (not under `commit only`).
5. `/commit` in the worktree with the `commit:` subject. It lands the change the way `AGENTS.md` says (by default `cd <root> && bun repo worktree finish fast-{serial}-{name}`).

Set `status: blocked` only when it cannot land (a rebase conflict you cannot resolve, a hook citing a path outside the plan); leave the worktree and say where. Under `/away` do not ask: decide, log `- decision: {question} → {choice}, because {why}` in an optional trailing `## Previous mistakes` of the fast plan, and continue.
