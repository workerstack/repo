---
name: ask
description: "Session flag. Finish one step, recap, then ask before the next."
---
# ask

Session flag. Slash `/ask` stamps this session.

Finish one coherent step. Recap what landed. Ask whether to continue. Wait. Do not start the next step in this turn.

`/auto` is the default flag: keep going; ask only on blockers. Config `sessionGate` in `.rulesync/grunt.config.jsonc` (`auto`|`ask`, default `auto`). Slash ≠ config stamps; slash == config unlinks.
