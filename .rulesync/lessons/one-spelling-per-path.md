---
name: one-spelling-per-path
paths: [".rulesync/scripts/workspace-root.mjs",".rulesync/scripts/gate-fat-tools.mjs",".rulesync/scripts/worktree.mjs",".rulesync/scripts/gitignore-guard.mjs",".rulesync/scripts/lessons.mjs",".rulesync/scripts/doctor.mjs",".rulesync/scripts/grunt-job.mjs",".rulesync/scripts/persist-plan.mjs",".grok/hooks/orchestrate-parent.js"]
hits: 1
last-hit: 2026-11-04
evidence: ["v0.16.0 test-windows"]
---

# Paths compared in two spellings of one dir never match

A check that compares a typed path, the hook cwd or git's output against the roots silently misses when one side is a symlink, a junction or a Windows 8.3 short name.

## Mistake
v0.16.0 failed 42 Windows tests and never published. `os.tmpdir()` on the runner is `C:\Users\RUNNER~1\…`, git prints `C:/Users/runneradmin/…`, and `fs.realpathSync` (JS) does not expand 8.3 names. `resolveRoots` returned a long root with a short cwd, so the re-read deny, the nested `.gitignore` guard, lesson matches and plan citations missed, and the worktree guard denied a correct `git worktree add`. The same split happened on Linux from a symlinked checkout.

## Fix
Compare a path only after `canonicalPath` (paths git prints, roots passed in) or `resolveTyped(roots, raw)` (paths an agent typed), both in `workspace-root.mjs`. Test each check through `aliasOf` from `dev/test-paths.ts`, which gives the 8.3 form on Windows and a symlink elsewhere, and push so Windows CI runs before any tag.
