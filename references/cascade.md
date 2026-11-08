---
tags: [cascade]
---

# Protocol

The session agent has tools. Fat Read/Grep/Bash dumps are rewritten to `<root>/node_modules/.bin/repo job` (squeez + stash). Isolation facts stay ≤8 lines.

Run `bun repo job --job search|exec|slice|fetch|test` first. Spawn scout when the dump needs judgment (browse snap, messy test log) and the return is a short isolation fact; spawn researcher for heavy web or browser research that returns facts with sources. Use a host agent or a fan-out when that split is cheaper for the task, or when the user asks for it.

`need:` JSON (search|exec|slice|fetch) may be intercepted in-hook (cap 4). Peek/kill if a child is running: Grok `get_command_or_subagent_output` `timeout_ms=60000`. Other hosts: block on spawn return.

Session flags: `/auto` (default) keeps going and asks on blockers instead of monkey-patching. `/ask` finishes one step, recaps, then asks. Slash `/ask` stamps `.tmp/repo/orchestrator-logs/session-gate-{sid}`; `/auto` unlinks.

Scratch: `.tmp/repo/`. Stash: `.tmp/repo/stash/`. Sessions: `.tmp/repo/sessions/{sid}/`. Browser: `.tmp/repo/browser/`.
