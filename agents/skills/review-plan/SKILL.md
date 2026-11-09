---
name: review-plan
description: Review a plan in a fresh agent before approval. Use for /review-plan.
---
# review-plan

You review one plan under `.tmp/repo/plans/` that someone else wrote. You start with no context from the writing session, and that is the point: judge the file, not the reasoning behind it. Format: `node_modules/@workerstack/repo/references/plan-format.md`. Lessons: `node_modules/@workerstack/repo/references/lessons.md`.

Slash `/review-plan {n|path}` only. Not a session flag. `/write-plan` runs it in a fresh agent after every write or revision. Run it yourself on any plan.

Read-only. Write nothing: not the plan, not a lesson, not a journal. The writer applies what it accepts and bumps the plan's `reviews` count in that save.

Rounds repeat: the first runs after `/write-plan`, another after each revision, and anyone can run one by hand. The count proves a round ran and was settled, not that it was good. A plan cannot move to `in-progress` until `reviews` is at least 1.

Scripts already enforce the format, the card's shape, the 100-line cap, reads-only phases, disjoint `parallel:` lists, the append-only `## Previous mistakes`, and the lesson citations. Do not re-check those. Check what a script cannot:

1. Read the plan in full.
2. Read its `## Previous mistakes`. Flag any leaf that brings a recorded mistake back.
3. Run `bun repo lessons match` on the paths the plan names (repo-relative or absolute; `match` is read-only and runs from the root). Read each matched lesson. Flag a lesson cited in Watch-outs that no leaf acts on.
4. Read each principle skill the plan names. Flag a leaf that goes against it.
5. Check the type row in `node_modules/@workerstack/repo/references/scope.md` ## Types and its ## Facts: a missing failing-test leaf, a named principle with no Read leaf, a Read leaf outside the phase it gates, or a named check dropped without a reason.
6. Flag a leaf that needs more planning before someone can do it: an open choice, a vague target, or a path that does not exist.
7. Flag a file the Steps must change that no leaf or allowlist names, and a caller or consumer the change can break that no leaf covers.
8. Compare `## Usage` with Steps. Flag each new or changed command, flag, output, error message, or file a person or agent touches that Usage does not show, a changed one shown without its before, and a `No visible change:` line on a plan that changes one.
9. Compare the card with Goal and Steps. Flag a `WHAT` or `DONE` that Goal and Verify do not back, a `TOUCH` that misses a file the Steps change, and a `RISK` no leaf or Watch-out covers.
10. For each `(parallel: …)` phase, flag a path its leaves name that is not in its list.

Reply with at most 10 findings, most severe first, one line each: `{leaf id or section}: {problem}; {fix}`. With nothing to flag, reply `no findings`. No praise and no summary.
