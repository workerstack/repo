---
name: bun-name-runs-local-file
paths: ["cli/main.ts","cli/commands.ts","bin/repo.ts","dev/link-self-bin.ts"]
hits: 1
last-hit: 2026-11-08
evidence: ["plan 10"]
---

# `bun <name>` runs `./<name>.ts` before the bin

`bun repo …` and `bun run repo …` run a `repo.ts` or `repo.js` in the cwd instead of `node_modules/.bin/repo`, and a module with no entry code exits 0 having done nothing.

## Mistake
Plan 10 moved agent text to `bun repo <cmd>`. From `cli/`, `bun repo version` printed nothing and exited 0, because bun resolved `cli/repo.ts` (the CLI module, which only exports `start`) ahead of the bin. Any `bun repo worktree add` typed there would have silently not run. `bunx repo` does resolve the local bin first, but fetches the unrelated npm `repo` package when no install exists.

## Fix
No tracked file other than `bin/repo.ts` may be named `repo.{ts,tsx,js,jsx,mjs,cjs}`: the CLI module is `cli/main.ts`, and `cli/commands.test.ts` fails on a new one. Prove a `bun <bin>` call from every dir an agent works in, not just the root.
