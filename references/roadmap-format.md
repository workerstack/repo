---
description: Roadmap file format
---

# Roadmap format (SSOT)

Ordered program of child plans. Not a plan, a handoff, or a design doc.

## Path

`.repo/roadmaps/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`

- **serial:** unpadded decimal int ≥ 1. Never `0001`.
- **filename:** `^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.md$`
- Create mints the next serial. A later write of an existing file keeps that path and serial. The hook validates the update and the host writes it. An Edit of a saved roadmap is checked against the text it would produce, and a valid one runs as sent.
- Child plans stay in `.repo/plans/`.

## Frontmatter

```yaml
---
serial: 1
name: auth-program
status: draft          # draft | locked | in-progress | done | blocked
reviews: 0             # settled /review-roadmap rounds; never lowered or removed
created: 2026-10-25T18:00:00Z
source: "<≤120 chars>"
strategy: free          # free | spawn-fast | spawn-deep
mode: away             # optional: ask | auto | away
---
```

`draft` → `locked` → `in-progress` → `done` | `blocked`.

`strategy` is required: `free`, `spawn-fast` or `spawn-deep`. It means what it means in a plan (see `plan-format.md`). On a roadmap it is the default its slices copy: each slice plan starts with the roadmap's value, unless that slice's scope argues for another. A save with no `strategy` or an unknown value is denied with `strategy: free|spawn-fast|spawn-deep`. A body-only save may send a bare `strategy: {value}` line above `ROADMAP_NAME:`, and a save that omits it keeps the saved value. The person can change the value with a code such as `isf` when approving, or `hsf` when handing off.

`mode` is optional: `ask`, `auto` or `away`, as in a plan (see `plan-format.md`); any session stamp beats it. A body-only save may send a bare `mode: {value}` line above `ROADMAP_NAME:`, and a save that omits it keeps the saved value. Another value is denied with `mode: ask|auto|away`.

`/implement-roadmap-deep` refuses `draft`.

`reviews` counts the `/review-roadmap` rounds whose findings the writer settled. It starts at `0`, never goes down, and once present cannot be removed. A body-only save sends it as a bare `reviews: {n}` line above `ROADMAP_NAME:`, and a save that omits it keeps the saved count. Moving into `locked` needs `reviews` ≥ 1; a missing key counts as 0. A roadmap already past `draft` without the key stays editable.

## Body (this order only)

A roadmap is pointers: what each slice ships, in order. Decisions, Usage, context and the why of each slice go into that slice's plan, which `/implement-roadmap-deep` writes.

```
# auth-program

WHAT   auth ships as two slices: reserved types first, then the commit diff pass
WHY    later slices add skills, so their names must be reserved first
RISK   init and INDEX drift apart when a name changes
TOUCH  init reserved names, INDEX, commit skills
DONE   both slices done; repo init lists auth-types

## Order
1 [ ] auth types: Reserved names list the new skills.
      Location: /home/me/app/.repo/plans/14-auth-types-20261025T165531Z.md
2 [ ] commit diff pass: Commit skills strip narrating comments.

## Verify
3 [ ] Verify
3.1 [ ] both child plans have finished Verify

## Previous mistakes
(none)
```

- **Card:** the 5 lines after `# {slug}` and one blank line, as in a plan (`plan-format.md`): WHAT, WHY, RISK, TOUCH, DONE, text at column 8, at most 120 characters each.
- **Headings:** `## Order`, `## Verify`, `## Previous mistakes`, nothing else. Lines inside a code fence are never headings. A new roadmap with any other `##` is denied with `a new roadmap has only ## Order, ## Verify and ## Previous mistakes; move ## {heading} into the slice plans`.
- **Slice:** one line, `N [ ] {title, 2–6 words}: {one sentence}`. The sentence says what that slice's plan ships. A slice that breaks it is denied with `slice N needs "N [ ] {title, 2–6 words}: {one sentence}"`.
- **Location:** an optional indented line under the slice. Omit it in a draft. `/implement-roadmap-deep` sets it to the absolute plan path `/write-plan-deep` reported; a slice that has one does not get a second plan. A relative `.repo/plans/{file}` also resolves.
- `[x]` only after that child plan's Verify is done.
- **Verify:** 1–5 runnable program gates, same `N.M [ ]` grammar as plans.
- **Previous mistakes:** `(none)`, or one entry per line. Append-only.
- **Cap:** at most 60 lines above `## Previous mistakes`, frontmatter included, `Location:` lines not counted, so filling them in mid-run never trips it. A fresh save past 60 is denied with `{n} lines above ## Previous mistakes, the cap is 60; move detail into the slice plans`; an update only when it grows past both 60 and the saved file.

A roadmap has at least two slices. One slice is `/write-plan-deep`.

### Roadmaps saved before pointers

A roadmap saved with `## Goal` keeps that shape and its rules for every later save, even one that deletes `## Goal`: the saved file decides. Its headings are `# {slug}`, `## Goal` (1–3 sentences), `## Usage`, `## Context`, `## Decisions`, `## Order`, `## Watch-outs`, `## Verify`, `## Previous mistakes`; Context, Decisions and Watch-outs are bullets, each decision naming the rejected alternative. Each slice is `N [ ] Title: {2–6 words}` with indented `Goal:` (one sentence), `Why:` (one or two sentences) and the optional `Location:`. It has no card and no cap. One saved before `## Usage` or `## Previous mistakes` existed stays valid without them.

## Previous mistakes

Mistakes about the program: slice order, slice boundaries, a premise later slices lean on, and on an old-shape roadmap a Decision that turned out wrong. A mistake inside one slice stays in that child plan.

```
- {feedback|verify|review|premise|decision|slice}: {what was wrong} → {what changed}
- decision: {question} → {choice}, because {why}
```

- `feedback`, `review`, `premise` and `decision` mean what they mean in a plan. `verify` is a failed program Verify gate.
- `slice` is roadmap-only: what child plan N found that changed the Order or a later slice (or a Decision on an old-shape roadmap). The same save makes that change.
- Optional ` (lesson: {slug})` at the end when the entry is also a lesson.
- `/implement-roadmap-deep` copies each entry that touches a slice into that slice's plan Watch-outs, and promotes entries that outlive the program to lessons before `done`.

## Validation checklist

- filename stamped and unpadded; `name` equals the slug
- `status` is one of the five values; `source` ≤120; `strategy` is one of the three values; `mode`, when present, is `ask`, `auto` or `away`
- a new roadmap: the card; only Order, Verify and Previous mistakes, in that order; ≥2 one-line slices, title 2–6 words, one sentence; at most 60 lines above Previous mistakes without `Location:` lines
- an update keeps the saved file's shape; an old-shape one keeps the old checks: headings in order, Goal 1–3 sentences, bulleted Context, Decisions and Watch-outs, ≥2 slices each with Title (2–6 words), one-sentence Goal and Why (1–2 sentences)
- Location, when present, is the absolute plan path (a relative `.repo/plans/{file}` still resolves)
- Verify has 1–5 leaves
- `## Previous mistakes` is last, required on a fresh create, and keeps every saved entry unchanged and in order
- `reviews` is a whole number, never lower than the saved one; `locked` needs at least 1
- a fresh create is `draft`, `reviews: 0`, and has no `[x]`
