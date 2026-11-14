---
name: su
description: 'Short status update: done, next, and blockers or on-track ETA. Takes an optional window such as 30m, 4h or overnight.'
---
This reply only: a status update in two to four short lines. No process narration.

First run `bun repo su --session <sid> [window]`. Take `<sid>` from the hook's `session=.repo/tmp/sessions/<sid>/` line. Pass the window the person gave (`30m`, `4h`, `2d`, `overnight`); with none, the command lists the plans and roadmaps this session saved. With a window it lists every plan and roadmap changed in it and the main commits. Build the reply from that output, not from memory.

- Done: what is finished. Flag anything unverified.
- Next: the immediate next step.
- Health: if stuck, blocked, broken, or slipping, say so plainly. Otherwise "On track" with a rough ETA (minutes, ~1h, end of session).

Never soften bad news or claim progress not made.
