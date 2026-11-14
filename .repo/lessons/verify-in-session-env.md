---
name: verify-in-session-env
paths: ["cli/scripts/workspace-root.ts","cli/scripts/gate-fat-tools.ts","cli/scripts/worktree.ts","cli/scripts/clean.ts","cli/scripts/doctor.ts"]
hits: 3
last-hit: 2026-11-14
evidence: ["roadmap 1","plan 68","roadmap 16"]
---

# Unset repo's session root vars in every Verify and spawned test

## Mistake
`resolveRoots` reads `GROK_WORKSPACE_ROOT` and `CLAUDE_PROJECT_DIR` before the cwd. Checks run in a scratch repo with them set measured repo itself and passed while proving nothing, three times in roadmap 1.

## Fix
Every Verify step and test that spawns a repo script unsets both (`env -u …`, `delete env[k]`) unless it sets one on purpose. Write it into the leaf, and assert a path under the scratch repo, not just a pass.
