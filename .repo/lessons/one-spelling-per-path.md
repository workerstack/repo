---
name: one-spelling-per-path
paths: ["cli/scripts/workspace-root.ts","cli/scripts/gate-fat-tools.ts","cli/scripts/worktree*.ts","cli/scripts/ignore-edits.ts","cli/scripts/redundant-ignore-lines.ts","cli/scripts/lessons*.ts","cli/scripts/doctor.ts","cli/scripts/job*.ts","cli/scripts/persist-plan.ts","cli/scripts/persist-plan-validate.ts","cli/scripts/orchestrate*.ts"]
hits: 1
last-hit: 2026-11-04
evidence: ["v0.16.0 test-windows"]
---

# Compare paths only after canonicalPath or resolveTyped

## Mistake
A check comparing a typed path, the hook cwd or git's output against the roots misses when one side is a symlink or a Windows 8.3 short name. v0.16.0 failed 42 Windows tests and never published.

## Fix
Compare only after `canonicalPath` (git output, passed roots) or `resolveTyped(roots, raw)` (typed paths), both in `workspace-root.ts`. Test each check through `aliasOf` from `dev/test-paths.ts`, and push so Windows CI runs before any tag.
