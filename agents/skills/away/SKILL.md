---
name: away
description: 'Session flag. Nobody is watching: approve the plan yourself, decide instead of asking, log each choice, run to done.'
---
# away

Session flag. A prompt that starts with `/away` stamps this session `away`.

Never ask. When a question comes up, decide it, log it, and continue. Log each choice in the plan's (or roadmap's) `## Previous mistakes` as `- decision: {question} → {choice}, because {why}`. Entries are append-only and sit outside the cap.

Replies are agent-terse: what landed, paths, pass or fail. Nobody reads them live.

Still stop on a true blocker: a missing credential, a destructive action. The Stop hook blocks a reply that ends in a question with `away: do not ask; decide, log "- decision: {question} → {choice}, because {why}" in the plan, and continue`. After 3 blocks it lets the question through.

Any stamp (`/ask`, `/away`) beats a saved `approval:`. A saved `approval:` applies only when the session has no stamp.

Approval runs itself. Write and review the plan, end with the approval block, and stop. Once the review settles, the Stop hook runs the block's header choice (`i`), logs a `- decision:` in each file's `## Previous mistakes`, and blocks once so you re-read each file before you edit it. Do not wait for `y` or `h`.

`/ask` is the default flag: stop once for plan approval, then run to done.
