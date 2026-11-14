---
description: Shrink big tool output
---

# Protocol

The session agent has tools. Fat Read/Grep/Bash dumps are rewritten to `<root>/node_modules/.bin/repo job` (squeez + stash). Isolation facts stay ≤8 lines.

Run `bun repo job --job search|exec|slice|fetch|test` first. Spawn scout when the dump needs judgment (browse snap, messy test log) and the return is a short isolation fact; spawn researcher for heavy web or browser research that returns facts with sources. Use a host agent or a fan-out when that split is cheaper for the task, or when the user asks for it.

`need:` JSON (search|exec|slice|fetch) may be intercepted in-hook (cap 4). Peek/kill if a child is running: Grok `get_command_or_subagent_output` `timeout_ms=60000`. Other hosts: block on spawn return.

Session flags: `/ask` (default) stops once for plan approval, then runs to done; it asks only on a blocker or a real choice. `/away` approves the plan itself once the review settles, decides instead of asking, and logs each choice as a `- decision:` entry in the plan. A prompt that starts with `/ask` or `/away` stamps `.repo/tmp/orchestrator-logs/session-gate-{sid}` with `ask` or `away`. Any stamp beats a plan or roadmap `mode:`, which applies only with no stamp. Under away the Stop hook runs the approval block's header choice once the review settles and logs the decision.

Scratch: `.repo/scratch/`. Stash: `.repo/tmp/stash/`. Sessions: `.repo/tmp/sessions/{sid}/`. Browser: `.repo/tmp/browser/`.
