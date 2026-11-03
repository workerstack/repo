---
name: gate-guard-before-early-return
paths: [".rulesync/scripts/gate-fat-tools.mjs",".grok/hooks/orchestrate-parent.js"]
hits: 1
last-hit: 2026-11-03
evidence: ["roadmap 1"]
---

# Gate guards placed after an early return skip grunt subagents and Antigravity

A deny rule added to the gate never ran for grunt subagents, or for harnesses that only reach the gate.

## Mistake
`processFatTools` returns early for grunt subagents and for write kinds it rewrites, and Antigravity calls reach only the gate, never `orchestrate-parent.js`. In roadmap 1, the `.gitignore` and `git worktree add` guards were first drafted after those returns, or in orchestrate-parent alone, so a grunt worker or an Antigravity agent would have bypassed them.

## Fix
Put every deny guard in `processFatTools`, right after `toolCallOf` and the field, patch and `shellCwd` setup, before the first early return. Read the shell command through the per-harness `TOOLS` table. Test each guard with an `agent_type: "grunt"` payload and an Antigravity `toolCall` payload.
