---
description: Fast plan file format
order: 100
---

# Fast plan format (SSOT)

A short checklist for work the person chose to do fast. Saved by `cli/scripts/persist-fast-plan.ts`. Default is a plan (`plan-format.md`).

## Path

`.repo/plans-fast/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`, named like a plan.

## Frontmatter

`serial`, `name`, `status` (`ready | in-progress | done | blocked`), `created`, `source`, optional `commit:`, `strategy`, and optional `advice`. No `reviews`.

## Strategy

`strategy` is `free`, `spawn-fast` or `spawn-deep`, with the meanings in `plan-format.md`. The save sets it from the session value, then the newest in-progress fast roadmap this session saved, then `agents.defaultStrategy`, then `free`. A sent `strategy:` line that differs from that value is denied with the plan's text. A rewrite that omits it keeps it, and an unknown value is invalid with `strategy: free|spawn-fast|spawn-deep`.

`advice` is optional: `advice: {free|spawn-fast|spawn-deep} because {reason}`, at most 100 characters, sent beside `commit:`. It moves into the frontmatter after `strategy:`. A rewrite that omits it keeps it. A bad line is denied with `advice: {free|spawn-fast|spawn-deep} because {reason}, at most 100 characters`.

## Body

The first line is `FAST_PLAN_NAME: <name>`, then `commit:` and `advice:`, then `# {slug}`, then `## Goal`, `## Steps`, `## Verify`, in that order, then an optional `## Previous mistakes`. Steps and Verify are flat `N [ ] text` boxes; a step may end `(parallel: <path>, …)` (Parallel steps). A new plan has only `[ ]`. No review, so `in-progress` needs none.

## Parallel steps

A step may end `(parallel: <path>, <path>, …)`, listing every file it writes, with the entry kinds and overlap rule of `plan-format.md` Parallel phases. Adjacent marked steps form a group whose steps can run at the same time. A group needs two or more steps, and no two of its lists may share a path. Only Steps take the marker:

```markdown
## Steps
1 [ ] parse the flag in `src/parse.ts` (parallel: src/parse.ts, src/parse.test.ts)
2 [ ] print it in `src/print.ts` (parallel: src/print.ts, src/print.test.ts)
3 [ ] wire both into `src/cli.ts`
```

Under `spawn-fast` or `spawn-deep` the session spawns a group's implementers in one message, each writing only its own list, then checks the round with `bun repo phase-files <fast plan path> <steps>` (the path, never the serial: a serial names a plan in `.repo/plans/`) and runs the full suite once. Under `free` the steps run in order and the marker changes nothing.

## Cap and denials

At most 40 lines, frontmatter included; the `strategy:` and `advice:` lines, `## Previous mistakes` and its lines are outside the cap. It is append-only, and under `/away` it holds the `- decision:` lines. Replies:

- `a fast plan holds only Goal, Steps and Verify, then an optional Previous mistakes`
- `a fast plan is at most 40 lines; write a plan (/write-plan-deep)`
- `a new fast plan has only [ ] boxes`
- `step 3 is parallel alone; parallel needs two or more adjacent steps`
- `step 1 is parallel with no files; list the files it writes after parallel:`
- `parallel steps 1 and 2 both list src/cli.ts; parallel steps need disjoint files`
- `parallel steps 1 and 2 overlap at src/ and src/cli.ts; parallel steps need disjoint files`
- `verify box 4 ends with parallel:; only steps may run at once`

## Approval

The plan's block (`plan-format.md`): header `fast-plan {n} · {strategy}`, an advice row when the file has `advice:`, then the `i` and `h` rows with their strategy words. On Claude Code the picker asks the Strategy question too. `i` runs `/implement-plan-fast {n}`; `i fast` writes `spawn-fast` first and sets the session strategy; `h` hands off with `/implement-plan-fast {n}` as Next.

A fast roadmap (`fast-roadmap-format.md`) runs its slices as fast plans.
