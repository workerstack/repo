---
name: auto
description: "Session flag. Default. Work the task through. Ask on blockers instead of monkey-patching."
---
# auto

Session flag. Default. Slash `/auto` stamps this session.

Work the task through. Do not stop after each step. When a blocker, missing fact, or real choice appears, stop and ask. Do not monkey-patch around a failure.

`/ask` is the other flag: one step, then ask. Config `sessionGate` in `.rulesync/grunt.config.jsonc` (`auto`|`ask`, default `auto`). Slash ≠ config stamps; slash == config unlinks.
