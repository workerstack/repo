---
name: set
description: 'Session setting. Set approval (ask, away), effort (fast, deep) and strategy (free, spawn-fast, spawn-deep) for this session, any subset in any order.'
---
# set

Session setting. `/set <words>` saves the words for this session; they survive a compact.

Seven words, one setting each: `ask` or `away` for approval; `fast` or `deep` for effort; `free`, `spawn-fast` or `spawn-deep` for strategy. Give any subset in any order, for example `/set away spawn-fast`. A word sets only its own setting; the others keep their session value. Two words for one setting, or an unknown word, is an error and saves nothing.

When the prompt starts with `/set`, the hook already saved the change. Reply with the change or error line from the hook context and nothing else.

When the person asks in plain words ("go away mode", "use the fast plans"), run `bun repo set <words>`; the gate adds `--session`. Run it only then. Never change a setting on your own judgment. Say what changed.
