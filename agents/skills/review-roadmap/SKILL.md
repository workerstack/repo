---
name: review-roadmap
description: Review a roadmap in a fresh agent before lock. Use for /review-roadmap.
---
# review-roadmap

You review one roadmap under `.tmp/repo/roadmaps/` that someone else wrote. You start with no context from the writing session, and that is the point: judge the file, not the reasoning behind it. Format: `node_modules/@workerstack/repo/references/roadmap-format.md`. Lessons: `node_modules/@workerstack/repo/references/lessons.md`.

Slash `/review-roadmap {n|path}` only. Not a session flag. `/write-roadmap` runs it in a fresh agent after every write or revision. Run it yourself on any roadmap.

Read-only. Write nothing: not the roadmap, not a plan, not a lesson. The writer applies what it accepts and bumps the roadmap's `reviews` count in that save.

Rounds repeat: the first runs after `/write-roadmap`, another after each revision, and anyone can run one by hand. The count proves a round ran and was settled, not that it was good. A roadmap cannot move to `locked` until `reviews` is at least 1.

Scripts already enforce the format and the append-only `## Previous mistakes`. Do not re-check those. Check what a script cannot:

1. Read the roadmap in full.
2. Read its `## Previous mistakes`. Flag a slice that brings a recorded mistake back.
3. Run `bun repo lessons match` on the paths the roadmap names (repo-relative or absolute; `match` is read-only and runs from the root). Read each matched lesson. Flag a slice that walks into one and no slice plan can avoid it.
4. Read `principle-sequence-verifiable-units`. Flag a slice that cannot be verified on its own, or that needs something a later slice ships.
5. Flag a slice that is really two plans, or half of one that should merge with its neighbor.
6. Flag a slice sentence too vague to write a plan from: an open choice, a vague target, or a path that does not exist.
7. Compare the card with the slices: flag a WHAT or DONE no slice ships, a RISK no slice handles, and a TOUCH that misses what the slices change.
8. Flag a Verify gate no one can run, and a DONE no Verify gate proves.
9. Flag a slice that ships code, tests or docs naming one consumer's private API, project, path or values; that work belongs in the consumer's repo, and examples use a made-up name.

A roadmap saved in the old shape (with `## Goal`) keeps the old checks as well: flag a Decision with no rejected alternative, a slice Goal or Why that contradicts a Decision, a slice that walks into a matched lesson with no Watch-out, a program Goal no Verify gate proves, and compare `## Usage` with the slices: each new or changed command, flag, output, error message, or file it does not show, a changed one shown without its before, and a `No visible change:` line on a roadmap that changes one.

Reply with at most 10 findings, most severe first, one line each: `{slice number or section}: {problem}; {fix}`. With nothing to flag, reply `no findings`. No praise and no summary.
