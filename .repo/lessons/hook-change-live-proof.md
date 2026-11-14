---
name: hook-change-live-proof
paths: ["cli/scripts/orchestrate*.ts","cli/scripts/persist-*.ts"]
hits: 3
last-hit: 2026-11-14
evidence: ["roadmap 8","roadmap 15","roadmap 16"]
---

# Prove a hook or persist change live, not only in unit suites

## Mistake
Plans 154 and 156 retyped persist and orchestrate code that every plan, roadmap and journal Write passes through. The unit suites use fakes, so a broken branch in the real hook shows only in a later session's save.

## Fix
First probe in a live host what it sends the hook, if the change needs it (roadmap 15: AskUserQuestion answers in PostToolUse). Then pipe PreToolUse payloads (a Write, an Edit, one that must be denied) to `CLAUDE_PROJECT_DIR=$PWD bun bin/repo.ts hook orchestrate-parent` in the worktree and main. Delete scratch files.
