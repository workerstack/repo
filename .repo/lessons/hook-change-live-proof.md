---
name: hook-change-live-proof
paths: ["cli/scripts/orchestrate*.ts","cli/scripts/persist-*.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# A hook or persist change is proven live against main

Hook suites passed, but nothing showed that the real save path behaved the same.

## Mistake
Plans 154 and 156 retyped persist and orchestrate code that every plan, roadmap and journal Write goes through. Unit suites drive those modules through fakes, so a changed branch in the real `repo hook orchestrate-parent` entry would not show up until a later session's save broke.

## Fix
Pipe a PreToolUse JSON payload for a scratch plan's Write, then its Edit, to `CLAUDE_PROJECT_DIR=$PWD bun bin/repo.ts hook orchestrate-parent`, once in the worktree and once in the main checkout. Compare the outputs and saved files, which should match except for serial and time. Include one payload that must be denied. Delete the scratch plans and sessions afterwards.
