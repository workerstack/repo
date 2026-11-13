---
name: auto
description: >-
  Session flag. Default. Work the task through. Ask on blockers instead of
  monkey-patching.
---
# auto

Session flag. Default. Slash `/auto` stamps this session `auto`, replacing any `/ask` or `/away` stamp. A stamp beats a saved `mode:`.

Work the task through. Do not stop after each step. When a blocker, missing fact, or real choice appears, stop and ask. Do not monkey-patch around a failure.

`/ask` is a second flag: one step, then ask. `/away` is the third: decide instead of asking, and log each choice.
