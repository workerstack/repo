---
description: Fast roadmap file format
order: 110
---

# Fast roadmap format (SSOT)

A short ordered program of fast plans, for work the person chose to do fast. Saved by `cli/scripts/persist-fast-roadmap.ts`. Default is a roadmap (`roadmap-format.md`).

## Path

`.repo/roadmaps-fast/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`. Serials count in `roadmaps-fast` only.

## Frontmatter

`serial`, `name`, `status` (`draft | locked | in-progress | done`), `created`, `source`, `strategy`, and optional `advice`. No `reviews`.

## Strategy

`strategy` is `free`, `spawn-fast` or `spawn-deep`, with the meanings in `plan-format.md`. The save sets it from the session value, then `agents.defaultStrategy`, then `free`. A sent `strategy:` line that differs from that value is denied with the plan's text. A rewrite that omits it keeps it, and an unknown value is invalid with `strategy: free|spawn-fast|spawn-deep`.

`advice` is optional: `advice: {free|spawn-fast|spawn-deep} because {reason}`, at most 100 characters, sent beside the name line. It moves into the frontmatter after `strategy:`. A rewrite that omits it keeps it. A bad line is denied with `advice: {free|spawn-fast|spawn-deep} because {reason}, at most 100 characters`. A fast plan written for a slice takes the fast roadmap's strategy unless the session has one.

## Body

The first line is `FAST_ROADMAP_NAME: <name>`, then `advice:`, then `# {slug}`, then `## Order` and `## Verify`, in that order, then an optional `## Previous mistakes`. Order has two or more slices, `N [ ] title: sentence`, each optionally ending `(parallel: <path>, …)` with the rules in `roadmap-format.md` Parallel slices; Verify is flat `N [ ] text` boxes numbered after the slices. A new roadmap has only `[ ]`.

## Cap and Location

At most 20 lines, frontmatter included; Location lines, the `strategy:` and `advice:` lines, and `## Previous mistakes` with its lines are not counted. Previous mistakes is append-only and holds the `- decision:` lines under `/away`. A slice may carry an indented `Location: <abs path>` line: an absolute path to a fast plan under `.repo/plans-fast/`.

## Denials

- `a fast roadmap holds only Order and Verify, then an optional Previous mistakes`
- `a fast roadmap is at most 20 lines; write a roadmap (/write-roadmap-deep)`
- `a fast roadmap has two or more slices; write a fast plan (/write-plan-fast)`
- `a new fast roadmap has only [ ] boxes`
- `a fast roadmap slice's Location is a fast plan under .repo/plans-fast/`
- `slice 3 is parallel alone; parallel needs two or more adjacent slices`
- `slice 1 is parallel with no paths; list the paths it changes after parallel:`
- `parallel slices 1 and 2 both list cli/init.ts; parallel slices need disjoint paths`
- `parallel slices 1 and 2 overlap at agents/skills/ and agents/skills/commit/SKILL.md; parallel slices need disjoint paths`

## Approval

The plan's block (`plan-format.md`): header `fast-roadmap {n} · {strategy}`, an advice row when the file has `advice:`, then the `i` and `h` rows with their strategy words. `i` sets `status: locked`, then runs `/implement-roadmap-fast {n}`; a strategy word writes that value first; `h` hands off with that as Next.

## Run

`/implement-roadmap-fast {n}` refuses a draft, sets `in-progress`, runs `/write-plan-fast` then `/implement-plan-fast` per open slice (no stop between), ticks each slice after its plan, runs Verify and sets `done`. A parallel group writes all its plans first, then runs free plans in commit-only `claude` subagents spawned in one message and spawn plans from the session, and runs mixed groups or any group under `workflow: "pull-request"` in order. It lands each plan in slice order after `bun repo slice-files` (a file outside the list moves that plan last), a rebase onto the default branch and `bun repo ci`.
