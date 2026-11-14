---
description: How changes land, per workflow
---

# Change workflow

`workflow` in `repo.config.ts` says where changes are made and how they reach the default branch: `"worktree"` (the default, also when the key or the config is missing), `"pull-request"` or `"main"`. `bun repo sync` writes the mode's steps into the workflow paragraph of `AGENTS.md`, so that paragraph is the one to follow. This file says what each command and gate does under each mode. `hooks.md` has the gate details, `exports.md` the `bun repo push` table.

## worktree

Every change is made in a managed worktree: `bun repo worktree add <name>` makes `.worktrees/<name>` on branch `wt/<name>`. Edit, test and commit there.

- `bun repo worktree finish <name>`, run from the root, rebases `wt/<name>` onto the default branch, fast-forwards the default branch to it, removes the worktree and deletes the branch, and origin's copy when there is one. It pushes nothing else.
- `bun repo push` from the root then pushes the default branch and waits on CI. On a `wt/*` branch it exits 1: finish first.
- `bun repo release` runs in the main checkout on the default branch: it commits the release, pushes it, waits on CI, then tags.
- Gates: a write into the main checkout is denied, outside `.worktrees/` and the ignored `.repo/` dirs. A commit, merge, cherry-pick, revert, am or pull there is denied with `the main checkout is shared: commit inside <root>/.worktrees/<name>, then run bun repo worktree finish <name>`. Stash, reset, checkout, switch, restore, clean and rebase there are denied as a risk to other sessions' work.

## pull-request

Changes are made in a managed worktree as under worktree, and the default branch takes them only through pull requests. It needs `gh`, logged in.

- `bun repo worktree finish <name>`, run from the root, fetches origin and reads the branch's pull request. With none open, it rebases `wt/<name>` onto `origin/<default>`, pushes it and opens its pull request. Run again after more commits, it pushes them to the open pull request. Once the pull request merged, it fast-forwards the default branch to origin's, removes the worktree and deletes both copies of the branch. A closed pull request is refused: `reopen it with gh pr reopen <number>, then run finish again`.
- `bun repo push` refuses the default branch with `<default> takes changes only through pull requests (workflow is pull-request): run bun repo worktree finish <name> to push wt/<name> and open its pull request`. On a `wt/*` branch it exits 1 and names finish, which pushes the branch itself.
- `bun repo release` never pushes the default branch. It commits the release in a `release-<version>-<short HEAD>` worktree and opens its pull request, then stops: `run bun repo release again once it merges`. That rerun lands the merged release commit, waits on CI for it and tags it. Run before the merge, it says the pull request is not merged yet.
- Gates: the worktree ones, plus a push or delete push of the default branch (also `--all` and `--mirror`) is denied from anywhere in the repo with the same text `bun repo push` prints. A word in the user's message does not lift this deny.

## main

Changes are made in the main checkout, on the default branch. There is no worktree step.

- Edit, test and commit in the main checkout, then run `bun repo push`, which pushes the default branch and waits on CI.
- `bun repo worktree add` and `finish` still work as under worktree, for a change you want apart.
- `bun repo release` works as under worktree.
- Gates: writes and commits in the main checkout pass. Stash, reset, checkout, switch, restore, clean and rebase there are denied as a risk to uncommitted work, unless the user's message asks for them.

## Every mode

A force push, and moving or deleting the default branch with `git branch` or `git update-ref`, are denied in every mode unless the user's message asks for them.

## A config that fails to load

When `repo.config.ts` throws as it loads, or `workflow` holds another value, each gate takes its strictest rule: the main checkout takes no writes or commits, and the default branch is not pushed (`(repo.config.ts failed to load)` in the deny). `bun repo worktree finish` refuses with `repo.config.ts failed to load: fix it, then run finish again`.
