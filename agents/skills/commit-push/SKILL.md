---
name: commit-push
description: >
  Commit with a Conventional Commits subject, then push. Use for /commit-push,
  "commit and push", "commit this and push". Must push. Never force-push.
---
Run `/commit`'s procedure (its never-push line is `/commit`'s alone), then push:

- Managed worktree: once `finish` landed it, run `bun repo push <default>` from the root, default = `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` without `origin/` (if that fails, ask). Name it: a bare push there picks a lone recent branch. If `finish` fails, resolve it as `/commit` says and push nothing.
- Anywhere else: `bun repo push`, or `bun repo push <branch>` for the branch the user named.

Run it with `run_in_background`, then read its exit:

- 0: done.
- 1, a managed worktree's branch refused: run `finish` for it and push from the root.
- 1, push or CI failed: read the lines it printed, fix in a new worktree (`bun repo worktree add <name>`), commit, push again. Three failed rounds on one job: report the failure and its logs and stop.
- 2: a newer push superseded it; run `bun repo ci wait <branch>` in the background again.
- 3: nothing to wait on; done.
- 4: report the line it printed.
- 5: run `bun repo push <branch>` with the branch the user means, or ask which.

Never force-push. Never `--force`, `-f`, `--force-with-lease`, `+<branch>`.

Protocol: `node_modules/@workerstack/repo/references/cascade.md`. Do not paste cascade.
