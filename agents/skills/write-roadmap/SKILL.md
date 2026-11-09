---
name: write-roadmap
description: >-
  Write an ordered program of plans under .tmp/repo/roadmaps/. Use for
  /write-roadmap. Stops for y, which locks and runs it.
---
# write-roadmap

You author the roadmap. First read `principle-sequence-verifiable-units` and follow it. Persist under `.tmp/repo/roadmaps/` via Write (hook runs `cli/scripts/persist-roadmap.ts`). Copy the shape below. All boxes `[ ]`. Status stays `draft` until the user replies `y`.

Author a bare `strategy: {value}` line above `ROADMAP_NAME:`. Values and the heuristic: `/write-plan`. Add a bare `mode: {value}` line beside it on the same terms as `/write-plan`: `away` when this session runs `/away`, or the mode the person asked for.

Before you ask the user, read `principle-never-block-on-the-human`. Ask only when the user alone can answer.

Two or more slices. One slice is `/write-plan`: say so and stop. Do not write a file.

Research until every slice is defensible. Ask only what changes the program. Then write the draft and stop.

After each save, spawn a fresh host agent whose prompt is only `/review-roadmap {n}` and the roadmap's absolute path (on Claude Code the `claude` agent type; scout is not the reviewer). Accept or reject each finding with a reason. Apply accepted ones to the same file and add one `- review: …` entry each to `## Previous mistakes`. Bump `reviews` by one in the save that settles the round, even with no findings: send a bare `reviews: {n}` line above `ROADMAP_NAME:`. The save denies a lower count.

On feedback, revise the same file (a Write of the saved path updates it in place), add a `- feedback: …` entry for what the user rejected and what changed, and run `/review-roadmap` again. Never edit or drop an earlier entry.

On `y`, set `status: locked` on the same file, then run `/implement-roadmap {n}`. On `h`, `h fast` or `h deep`, the hook writes the handoff: tell the person to run the `/pickup {serial}` it names in a fresh session, and do no work here. The save denies the lock while `reviews` is 0. Do not run `/write-plan` or `/implement-plan` from this skill.

Report the serial, the absolute path, the slice titles in order, the top risk, and the review findings you rejected with why. Stop and end the reply with two lines: `Strategy: {s}, because …` in one sentence, then the closing line from `/write-plan` for this roadmap, `Reply "y" to run roadmap {n} (strategy: {s}), or …, or "h" / "h fast" / "h deep" for a fresh session.`, in its queue form when other reviewed plans or roadmaps wait. Only after the review settled (`reviews` bumped since the review spawn); the Stop hook blocks it otherwise. Ask for approval no other way.

## Shape

`ROADMAP_NAME:` is 3–6 words. The hook turns it into the slug and the frontmatter. Do not invent `serial`, `created`, or `source`.

````
strategy: default
ROADMAP_NAME: auth program

# auth-program

WHAT   auth ships as two slices: reserved types first, then the commit diff pass
WHY    later slices add skills, so their names must be reserved first
RISK   init and INDEX drift apart when a name changes
TOUCH  init reserved names, INDEX, commit skills
DONE   both slices done; repo init lists auth-types

## Order
1 [ ] auth types: Reserved names list the new skills.
2 [ ] commit diff pass: Commit skills strip narrating comments.

## Verify
3 [ ] Verify
3.1 [ ] both child plans have finished Verify

## Previous mistakes
(none)
````

## Row rules

- The card comes first, as in `/write-plan`: WHAT, WHY, RISK, TOUCH, DONE, text at column 8, at most 120 characters each.
- Headings, this order only: Order, Verify, Previous mistakes. No other `##`.
- Each slice is one line: `N [ ] {title, 2–6 words}: {one sentence}`. The sentence is what that slice's plan ships.
- Decisions, Usage, context and why a slice sits where it does go into that slice's plan, not the roadmap. `/implement-roadmap` writes each plan from its line.
- At most 60 lines above Previous mistakes. Past that, move detail into the slice plans.
- Omit `Location` on a draft. `/implement-roadmap` fills it with the absolute plan path.
- No Type. No Commit. Those go on the child plan.
- Verify is 1–5 leaves, `N.M [ ]`, same grammar as a plan.
- Previous mistakes is `(none)` on a new roadmap, then one `- {feedback|verify|review|premise|decision|slice}: {what was wrong} → {what changed}` line per entry (a decision is `- decision: {question} → {choice}, because {why}`), optional ` (lesson: {slug})`. Append-only.
- A roadmap saved in the old shape, with `## Goal`, keeps it on every revision: `node_modules/@workerstack/repo/references/roadmap-format.md`.
