---
name: implement-plan-fast
description: 'Execute a .repo/plans-fast checklist inline in this session.'
---
# implement-plan-fast

`/implement-plan-fast {n|path}`. Do the plan here: no subagents, no journal. Empty arg: the unique in-progress, else unique ready fast plan, else list serials.

1. Set frontmatter `status: in-progress` (Edit the saved file).
2. `bun repo worktree add fast-{serial}-{name}`. Edit and test only there.
3. Per box, in order: for a behavior fix write the failing test and see it fail first, make the change, run the nearest tests, then tick the box (Edit the saved file).
4. Run the Verify boxes. Set `status: done`.
5. `/commit` in the worktree with the `commit:` subject. It finishes from the root: `cd <root> && bun repo worktree finish fast-{serial}-{name}`.

Set `status: blocked` only when it cannot land (a rebase conflict you cannot resolve, a hook citing a path outside the plan); leave the worktree and say where. Under `/away` do not ask: decide and continue.
