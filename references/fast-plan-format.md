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

The first line is `FAST_PLAN_NAME: <name>`, then `commit:` and `advice:`, then `# {slug}`, then `## Goal`, `## Steps`, `## Verify`, in that order, then an optional `## Previous mistakes`. Steps and Verify are flat `N [ ] text` boxes; a new plan has only `[ ]`. No review, so `in-progress` needs none.

## Cap and denials

At most 40 lines, frontmatter included; the `strategy:` and `advice:` lines, `## Previous mistakes` and its lines are outside the cap. It is append-only, and under `/away` it holds the `- decision:` lines. Replies:

- `a fast plan holds only Goal, Steps and Verify, then an optional Previous mistakes`
- `a fast plan is at most 40 lines; write a plan (/write-plan-deep)`
- `a new fast plan has only [ ] boxes`

## Approval

The plan's block (`plan-format.md`): header `fast-plan {n} · {strategy}`, an advice row when the file has `advice:`, then the `i` and `h` rows with their strategy words. On Claude Code the picker asks the Strategy question too. `i` runs `/implement-plan-fast {n}`; `i fast` writes `spawn-fast` first and sets the session strategy; `h` hands off with `/implement-plan-fast {n}` as Next.

A fast roadmap (`fast-roadmap-format.md`) runs its slices as fast plans.
