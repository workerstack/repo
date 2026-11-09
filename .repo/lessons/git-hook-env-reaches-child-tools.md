---
name: git-hook-env-reaches-child-tools
paths: ["cli/scripts/turn.ts","cli/scripts/turn-steps.ts","cli/scripts/lint.ts","agents/skills/commit/SKILL.md"]
hits: 1
last-hit: 2026-11-09
evidence: ["plan 31"]
---

# A git hook's GIT_* env reaches every tool it runs

Git runs a hook with GIT_INDEX_FILE, and GIT_DIR or other repo state in a linked worktree, set. Any child that inherits them aims its git calls at the repo being committed, whatever its cwd.

## Mistake
Plan 31 made pre-commit run `repo turn --staged`. Turn passed `process.env` to vitest, and the related tests' `git init`, `commit`, `branch`, `worktree add` and `config core.bare` in their own temp dirs hit the real repo: 45 commits on the worktree branch, 13 junk branches, two worktree registrations and `core.bare=true` in the shared config.

## Fix
Run every tool a hook can reach (oxfmt, oxlint, tsc, vitest, `repo sync`, `repo check`) through `toolEnv` in `cli/scripts/lint.ts`, which drops every `GIT_*` variable; `captureBun` applies it. Only the hook's own git calls (turn's change set and restage) keep the env, so a `git commit <paths>` temp index is still what they read. Test a hook-run tool with GIT_DIR and GIT_INDEX_FILE set, and check the repo is unchanged afterwards.
