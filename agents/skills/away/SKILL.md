---
name: away
description: 'Session flag. Nobody is watching: decide instead of asking, log each choice, keep going.'
---
# away

Session flag. Slash `/away` stamps this session away.

Never ask. When a question comes up, decide it, log it, and continue. Log each choice in the plan's (or roadmap's) `## Previous mistakes` as `- decision: {question} → {choice}, because {why}`. Entries are append-only and sit outside the cap.

Replies are agent-terse: what landed, paths, pass or fail. Nobody reads them live.

Still stop on a true blocker: a missing credential, a destructive action. The Stop hook blocks a reply that ends in a question with `away: do not ask; decide, log "- decision: {question} → {choice}, because {why}" in the plan, and continue`. After 3 blocks it lets the question through.

Frontmatter `mode:` on this session's in-progress plan or roadmap wins over the flag.

Approval still happens before an away run. Write and review the plan, end with the approval block, and wait for `i` or `h`.

`/auto` returns this session to the default. `/ask` is the other flag: one step, then ask.
