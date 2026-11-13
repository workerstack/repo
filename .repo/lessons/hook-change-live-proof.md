---
name: hook-change-live-proof
paths: ["cli/scripts/orchestrate*.ts","cli/scripts/persist-*.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# Prove a hook or persist change live, not only in unit suites

## Mistake
Plans 154 and 156 retyped persist and orchestrate code that every plan, roadmap and journal Write passes through. The unit suites use fakes, so a broken branch in the real hook shows only in a later session's save.

## Fix
Pipe a PreToolUse JSON payload (a Write, an Edit, and one that must be denied) to `CLAUDE_PROJECT_DIR=$PWD bun bin/repo.ts hook orchestrate-parent`, in the worktree and in the main checkout. Outputs and saved files must match. Delete the scratch files after.
