---
name: ask
description: 'Session flag. Default. Stop once for plan approval then run to done.'
---
# ask

Session flag. Default. Slash `/ask` stamps this session `ask`.

Write and review the plan, stop once for approval, then run to done. Ask only on a blocker or a real choice. Do not pause after each step.

`/away` is the other flag: decide instead of asking, log each choice, and let the Stop hook run the approval. Any stamp beats a saved `mode:`, so `/ask` beats a saved `mode: away`.
