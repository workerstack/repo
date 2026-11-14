---
name: rn
description: 'Run a task now: no plan, no review, no question. Its own worktree and the commit gate still apply.'
---
# rn

`/rn <task>`.

1. `bun repo worktree add <name>`. Edit only there.
2. Make the change, deciding as you go and asking nothing.
3. `/commit` in the worktree. The commit hook runs the related tests. Fix until it passes.
4. From the root, `bun repo worktree finish <name>`.

Empty task → reply `rn needs a task` and stop.
