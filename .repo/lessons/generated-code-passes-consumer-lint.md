---
name: generated-code-passes-consumer-lint
paths: ["cli/scripts/env-edit.ts", "cli/scripts/env-migrate-edit.ts", "cli/fixtures-rename.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 7"]
---

# Code a command writes into a consumer fails the consumer's own lint

`bun repo env set` and `bun repo env migrate` passed every unit test and every scratch-consumer proof, yet each value they sealed wrote a ~350-column `sealed("…")` line that `repo/max-line-width` refused at the consumer's next commit.

## Mistake
The plan 130, 135 and 137 proofs installed the packed tarball in a scratch consumer and ran the commands, but never ran `bun repo sync` there, so no pre-commit hook or lint ever saw the written file. The roadmap 7 program Verify synced the consumer and committed, and the hook refused it. oxfmt then moved the cipher onto its own line, which a text exemption would also have missed (plan 145).

## Fix
A plan whose command writes or rewrites source in a consumer proves the output on a synced consumer:
- Install the packed tarball, set `sideEffects` and `packageManager`, and run `bun repo sync` so the hooks and lint config are the consumer's.
- Run the command, run `bunx oxfmt` on what it wrote, then `bun repo lint` on those files and assert no line from a rule the output itself trips.
- Commit through the synced hooks, not with `core.hooksPath=/dev/null`.
Turn each hit into a failing test of the rule or the writer before the fix.
