---
name: ask
description: 'Session setting. Default. Stop once for plan approval then run to done.'
---
# ask

Session setting. Default. A prompt that starts with `/ask` saves approval `ask` for this session. `/set ask` writes the same store.

Write and review the plan, stop once for approval, then run to done. Ask only on a blocker or a real choice. Do not pause after each step.

`/away` is the other flag: decide instead of asking, log each choice, and let the Stop hook run the approval. A session value beats a saved `approval:`, so `/ask` beats a saved `approval: away`. `/set` sets effort and strategy too.
