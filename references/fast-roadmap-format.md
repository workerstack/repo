---
description: Fast roadmap file format
---

# Fast roadmap format (SSOT)

A short ordered program of fast plans, for work the person chose to do fast. Saved by `cli/scripts/persist-fast-roadmap.ts`. Default is a roadmap (`roadmap-format.md`).

## Path

`.repo/roadmaps-fast/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`. Serials count in `roadmaps-fast` only.

## Frontmatter

`serial`, `name`, `status` (`draft | locked | in-progress | done`), `created`, `source`. No `strategy`, no `reviews`.

## Body

The first line is `FAST_ROADMAP_NAME: <name>`, then `# {slug}`, then `## Order` and `## Verify`, in that order, then an optional `## Previous mistakes`. Order has two or more slices, `N [ ] title: sentence`; Verify is flat `N [ ] text` boxes numbered after the slices. A new roadmap has only `[ ]`.

## Cap and Location

At most 20 lines, frontmatter included; Location lines and `## Previous mistakes` with its lines are not counted. Previous mistakes is append-only and holds the `- decision:` lines under `/away`. A slice may carry an indented `Location: <abs path>` line: an absolute path to a fast plan under `.repo/plans-fast/`.

## Denials

- `a fast roadmap has no strategy`
- `a fast roadmap holds only Order and Verify, then an optional Previous mistakes`
- `a fast roadmap is at most 20 lines; write a roadmap (/write-roadmap)`
- `a fast roadmap has two or more slices; write a fast plan (/write-plan-fast)`
- `a new fast roadmap has only [ ] boxes`
- `a fast roadmap slice's Location is a fast plan under .repo/plans-fast/`

## Approval

Block: header `fast-roadmap {n}`, rows `i implement`, `h hand off`, `or reply to revise`. No strategy codes. `i` sets `status: locked`, then runs `/implement-roadmap-fast {n}`; `h` hands off with that as Next.

## Run

`/implement-roadmap-fast {n}` refuses a draft, sets `in-progress`, runs `/write-plan-fast` then `/implement-plan-fast` per open slice (no stop between), ticks each slice after its plan, runs Verify and sets `done`.
