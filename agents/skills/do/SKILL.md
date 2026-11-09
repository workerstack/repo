---
name: do
description: 'Do a small task now: no plan, no review. Worktree, nearest test and commit still apply.'
---
# do

`/do <task>`. Skip the plan and its review. Never skip the worktree, the nearest test or the commit gate.

1. `bun repo worktree add <name>`. Edit only there.
2. Make the change.
3. Run the nearest existing test. Fix until it passes.
4. `/commit` in the worktree.
5. From the root, `bun repo worktree finish <name>`.

A change that needs a decision stops before the first edit. Reply exactly:

```
this needs a decision; write a plan with /write-plan
```

Empty task → ask for a task and stop.
