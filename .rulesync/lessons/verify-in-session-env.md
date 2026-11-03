---
name: verify-in-session-env
paths: [".rulesync/scripts/workspace-root.mjs",".rulesync/scripts/gate-fat-tools.mjs",".rulesync/scripts/worktree.mjs",".rulesync/scripts/clean.mjs",".rulesync/scripts/doctor.mjs"]
hits: 1
last-hit: 2026-11-03
evidence: ["roadmap 1"]
---

# Verify runs inherit grunt's session root

A check run from an agent session measured grunt's own repo instead of the scratch repo it targeted.

## Mistake
`resolveRoots` reads `GROK_WORKSPACE_ROOT`, `GEMINI_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` before the cwd, and the agent's shell has `CLAUDE_PROJECT_DIR` set to grunt. Verify steps and tests that spawned grunt scripts in a scratch repo `S` with that env left set resolved the root to grunt, so they passed while proving nothing about `S`. This was found three times in roadmap 1 (Verify 6.2, 8.3-8.5, and plan 30's tests).

## Fix
Every Verify step and every test that spawns a grunt script deletes the three vars (`env -u …` in shell, `delete env[k]` in node), unless the case sets one on purpose. Write it into the leaf ("with `CLAUDE_PROJECT_DIR`, `GEMINI_PROJECT_DIR` and `GROK_WORKSPACE_ROOT` unset"), and make the check assert a path under `S`, not just a pass.
