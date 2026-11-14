---
description: Fast plan file format
---

# Fast plan format (SSOT)

A short checklist for work the person chose to do fast. Saved by `cli/scripts/persist-fast-plan.ts`. Default is a plan (`plan-format.md`).

## Path

`.repo/plans-fast/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`, named like a plan.

## Frontmatter

`serial`, `name`, `status` (`ready | in-progress | done | blocked`), `created`, `source`, and optional `commit:`. No `strategy`, no `reviews`.

## Body

The first line is `FAST_PLAN_NAME: <name>`, then `commit:`, then `# {slug}`, then `## Goal`, `## Steps`, `## Verify`, in that order, then an optional `## Previous mistakes`. Steps and Verify are flat `N [ ] text` boxes; a new plan has only `[ ]`. No review, so `in-progress` needs none.

## Cap and denials

At most 40 lines, frontmatter included; `## Previous mistakes` and its lines are outside the cap. It is append-only, and under `/away` it holds the `- decision:` lines. Replies:

- `a fast plan has no strategy`
- `a fast plan holds only Goal, Steps and Verify, then an optional Previous mistakes`
- `a fast plan is at most 40 lines; write a plan (/write-plan-deep)`
- `a new fast plan has only [ ] boxes`

## Approval

All-fast block: header `fast-plan {n}`, rows `i implement`, `h hand off`, `or reply to revise`. It has no strategy codes. `i` runs `/implement-plan-fast {n}`; `h` hands off with `/implement-plan-fast {n}` as Next.

A fast roadmap (`fast-roadmap-format.md`) runs its slices as fast plans.
