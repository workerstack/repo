---
name: backlog
description: Keep a gitignored list of things found but not done now, in .repo/backlog.md. Add, list, start, mark done, clear.
---
# backlog

`/backlog [text | start N | done N | clear]`

- `/backlog <text>` runs `bun repo backlog add <text>`.
- `/backlog` runs `bun repo backlog`.
- `/backlog start N` runs `bun repo backlog start N`.
- `/backlog done N` runs `bun repo backlog done N`.
- `/backlog clear` runs `bun repo backlog clear`, shows its question to the person, and runs `bun repo backlog clear --yes` only on their yes.

Print the command's output as is. Never edit the file by hand. N is a line number or text matching one item.
