---
name: write-roadmap-deep
description: 'Deep: write an ordered program of plans under .repo/roadmaps/. Stops for y, which locks and runs it. Short one: /write-roadmap-fast.'
---
# write-roadmap-deep

You author the roadmap. First read `principle-sequence-verifiable-units` and follow it. Persist under `.repo/roadmaps/` via Write (hook runs `cli/scripts/persist-roadmap.ts`). All boxes `[ ]`. Status stays `draft` until the user approves with `i`.

Author a bare `strategy: {value}` line above `ROADMAP_NAME:`. Values and the heuristic: `/write-plan-deep`. Add a bare `mode: {value}` line beside it on the same terms as `/write-plan-deep`: `away` when this session runs `/away`, or the mode the person asked for. Under away the Stop hook runs the approval block's `i` once the review settles.

Before you ask the user, read `principle-never-block-on-the-human`. Ask only when the user alone can answer.

Two or more slices. One slice is `/write-plan-deep`: say so and stop. Do not write a file.

Research until every slice is defensible. Ask only what changes the program. Then write the draft and stop.

After each save, spawn a fresh host agent whose prompt is only `/review-roadmap {n}` and the roadmap's absolute path (on Claude Code the `claude` agent type; scout is not the reviewer). Accept or reject each finding with a reason. Apply accepted ones to the same file and add one `- review: …` entry each to `## Previous mistakes`. Bump `reviews` by one in the save that settles the round, even with no findings: send a bare `reviews: {n}` line above `ROADMAP_NAME:`. The save denies a lower count.

On feedback, revise the same file (a Write of the saved path updates it in place), add a `- feedback: …` entry for what the user rejected and what changed, and run `/review-roadmap` again. Never edit or drop an earlier entry.

On `i`, a short yes or an `i` code, set `status: locked` on the same file, then run `/implement-roadmap-deep {n}`. On `h` or an `h` code, the hook writes the handoff: tell the person to run the `/pickup {serial}` it names in a fresh session, and do no work here. The save denies the lock while `reviews` is 0. Do not run `/write-plan-deep` or `/implement-plan-deep` from this skill.

Report the serial, the absolute path, the slice titles in order, the top risk, and the review findings you rejected with why. Stop and end the reply with the approval block from `/write-plan-deep` for this roadmap, headed `roadmap {n} · {s}`, in its queue form when other reviewed plans or roadmaps wait. Only after the review settled (`reviews` bumped since the review spawn); the Stop hook blocks it otherwise. Ask for approval no other way.

## Shape

Shape and row rules: `node_modules/@workerstack/repo/references/roadmap-format.md`.

`ROADMAP_NAME:` is 3–6 words. The hook turns it into the slug and the frontmatter. Do not invent `serial`, `created`, or `source`.

No Type. No Commit. Those go on the child plan.
