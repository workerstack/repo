---
name: turn-green-is-not-coverage-green
paths: ["cli/**/*.ts"]
hits: 2
last-hit: 2026-11-12
evidence: ["plan 149","roadmap 9"]
---

# A green turn still misses the 100% coverage floor

`bun repo turn` passed, then `bun repo ci` failed on the cli coverage floor for a new default io reader and a new error branch.

## Mistake
Plan 149 added `stdin: () => fs.readFileSync(0, "utf8")` as a default in `cli/commit-msg.ts` `main`'s io and a `sent === null` refusal in `cli/commit-range.ts`. Every test passed its own io, so the default lambda never ran, and no test reached the refusal. `turn` runs the related tests without coverage, so it stayed green. A test that spawns the bin does not help: a child process does not count toward vitest's in-process coverage.

## Fix
Give each new branch and each new default its own in-process test before you call a phase done. Build a default io from readers that are already covered (`readAllText.bind(undefined, processHookIo())` in `cli/scripts/hook-io.ts`) rather than a fresh inline lambda. Before the commit, run `bun repo ci`, or a vitest coverage run over the changed files, and read their per-file numbers.
