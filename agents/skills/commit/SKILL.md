---
name: commit
description: >
  Inspect the diff and commit with a Conventional Commits subject line. Use for
  /commit, "commit this", "commit these changes". /commit alone never pushes;
  /commit-push and its chains push after it.
---
Inspect `git status` + `git diff` (staged and unstaged) before the message.

Diff pass on the hunks you will stage: delete narrating comments, unused defensive guards or try/catch on trusted paths, `any` casts that only silence types, dead compatibility, and unrelated hunks. Keep a comment only when it states a constraint the code cannot encode. Keep behavior otherwise. Do not spawn a reviewer.

Stage only user intent. Never blind `git add -A` / `git add .`. Split unrelated concerns into multiple commits.

If a unique in-progress file exists under `.repo/implementations/`, its `## Files` is the default stage set. Still inspect `git status`.

Message = Conventional Commits **subject only**: `type(scope): subject` (scope optional).

Types: feat fix perf refactor test docs build ci chore revert.

Subject: imperative lowercase no trailing period.

NO body. NO footer. NO `Co-Authored-By`. NO `Generated with`. NO 🤖. NO trailers. No AI attribution. Work belongs to the human.

One exception: when the commit-msg hook refuses the commit for its size, add one body line saying why it is that big (`git commit -m "<subject>" -m "<why>"`), or split the commit.

## Where

Run `git rev-parse --show-toplevel` and `git branch --show-current` first.

- Managed worktree (`<root>/.worktrees/<name>` on `wt/<name>`): commit there, then land it the way `AGENTS.md` says (by default `cd <root> && bun repo worktree finish <name>`, from the root, not inside the worktree: its shell reports exit 1 after a successful finish, so do not rerun it). It rebases onto the default branch, fast-forwards it and removes the worktree; under `workflow: "pull-request"` it pushes `wt/<name>` and opens its pull request instead. A conflict aborts the rebase and the message names the files: resolve them in the worktree, rerun the checks, run `finish` again.
- Main checkout: under `workflow: "main"` commit there. Otherwise the gate denies a commit there unless the user's message names commit, and `/commit` does. Commit only changes the user made there. Your own changes belong in a worktree: run `bun repo worktree add <name>`, redo the work under `.worktrees/<name>`, and commit there. `bun repo init` and `bun repo sync` also run inside a worktree, so their output is never left in the main checkout.
- Any other linked worktree (T3 Code, Claude Desktop): commit only. `finish` cannot land it.

/commit alone never pushes: no `git push`, no `bun repo push` (under pull-request, `finish` pushes `wt/<name>` itself). /commit-push and its chains push after it.

Protocol: `node_modules/@workerstack/repo/references/cascade.md`. Do not paste.
