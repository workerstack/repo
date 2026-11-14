---
name: implement-plan-deep
description: 'Deep: execute remaining leaves in a .repo/plans checklist. Skip [x]. Short one: /implement-plan-fast.'
---
# implement-plan-deep

You execute the plan in this session. A plan with `reviews: 0` cannot start: the save denies the move to `in-progress`. Run `/review-plan {n}` in a fresh agent and settle it first. Start only on a plan the user approved, when the request said "plan and do it", or when `/implement-roadmap-deep` is running a `locked` or `in-progress` roadmap. Skip `[x]`. Before the first open leaf, run `git log -3 --stat` and reconcile any newer commit that touches a file the plan lists, then read the plan's `## Previous mistakes` and do not repeat one. Start at the first open leaf. Flip only the box after each leaf. When a phase's children are `[x]`, mark the phase `[x]`. Frontmatter `in-progress` then `done`.

strategy spawn-fast or spawn-deep: read node_modules/@workerstack/repo/references/review-loop.md first; a parallel group of phases runs at once, as it says. free: ignore this line.

Arg `{n|path}` picks that file. Empty arg: unique in-progress, else unique ready, else list serials.

Worktree: before the first open leaf, run `bun repo worktree add {serial}-{name}` (serial and name from the frontmatter; it prints `.worktrees/{serial}-{name}` and reuses one that exists). Every product edit, test run and commit happens there; the gate denies product writes and commits in the main checkout. The plan, the journal and `.repo/scratch/` stay in the root. A subagent starts in the root, so its prompt names the worktree path.

Format: `node_modules/@workerstack/repo/references/plan-format.md`. Write-allowlist = paths listed in the plan, repo-relative to the worktree; an absolute path under the root names the same path there. Run Verify leaves. Do not skip a test leaf. Do not flip a behavior leaf `[x]` until its test ran.

A leaf that names a principle skill is done by reading that skill and following it. Also follow the next paragraph, and read a principle an already-read principle cites. Do not open the rest of the catalog.

When a Verify or a test fails after a fix, or `principle-attack-the-premise` fires, add a `- verify: …` or `- premise: …` entry to `## Previous mistakes` (Edit the plan; earlier entries stay). When it will happen again on other tasks (Write a lesson only for a mistake our normal workflow will hit again on other tasks. A one-time issue stays in the plan's Previous mistakes.), run `bun repo lessons match` on the files involved, then `hit` the matching lesson or write a new one inside the plan's worktree (`node_modules/@workerstack/repo/references/lessons.md`), so it lands with the plan's commit, and end the entry with `(lesson: {slug})`.

Before Verify, read `principle-prove-it-works` and follow it. After two fixes that share a premise fail the same gate, read `principle-attack-the-premise` before a third try. Before you ask the user, read `principle-never-block-on-the-human`. Under `/away` (the stamp, or a saved `mode: away` when there is no stamp), do not ask: decide, add `- decision: {question} → {choice}, because {why}` to `## Previous mistakes`, and continue; stop only on a true blocker (a missing credential, a destructive action). Before a large dump or a fan-out, read `principle-guard-the-context-window`. Fat dumps go through `bun repo job`.

On a failing-test leaf, run the test and see it fail for the missing behavior before the production edit. Then make it pass. Then run the nearest suite.

After Verify, if frontmatter `commit:` is set, run `/commit` with that subject and the journal Files. One plan, one commit, including a failing-test leaf and the fix. If a git hook fails on a path inside the plan write-allowlist, fix that code and commit again until the hook passes. Stop when the hook cites a path outside the allowlist or a missing secret. Do not skip the hook. Do not push. A plan with no `commit:` key does not auto-commit and does not finish: leave the worktree and report its path.

`/commit` in the worktree then runs `cd <root> && bun repo worktree finish {serial}-{name}` (from the root: run inside the removed worktree, the shell reports exit 1 after a successful finish, so do not rerun it), which rebases onto the default branch, fast-forwards it and removes the worktree. On a rebase conflict it aborts, keeps the worktree and names the files: resolve them there, rerun the Verify checks, run `finish` again. Mark the plan `blocked` only when you cannot land it.

On start: if this plan has no journal, Write one under `.repo/implementations/` (`IMPL_NAME:`, `IMPL_PLAN: {n}`). Format: `node_modules/@workerstack/repo/references/implementation-format.md`. After each leaf: append `N.M [x] …` to Log, update Files (repo-relative product paths) and Done. Blocked → `status: blocked` and Blockers, e.g. `- finish could not land wt/{serial}-{name}: rebase conflict in src/x.ts left unresolved in {root}/.worktrees/{serial}-{name}`. Verify done → `status: done`. Straight shots do not write a journal.
