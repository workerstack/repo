---
tags: [lessons]
---

# Lessons

Mistakes that outlive one task. One committed file per mistake under `.repo/lessons/`, with a generated index. Not host memory: everything is in the repo and reaches every machine through git.

## Three layers

- **Plan:** `## Previous mistakes` in each plan holds that task's details: rejected approaches, failed Verify, accepted review findings. It stays with the plan in `.tmp/`. Format: `node_modules/@workerstack/repo/references/plan-format.md`.
- **Roadmap:** `## Previous mistakes` in a roadmap holds mistakes about the program: slice order, slice boundaries, and `slice` entries for what a child plan found that changed later slices. A roadmap saved in the old shape also logs its Decisions there; a pointer roadmap's decisions live in the slice plans. It lasts as long as the program, in `.tmp/`. Format: `node_modules/@workerstack/repo/references/roadmap-format.md`.
- **Repo:** a lesson holds a mistake that will happen again on other tasks. A plan entry that generalizes becomes a lesson, and the entry ends with `(lesson: {slug})`.

## File

`.repo/lessons/{slug}.md`, at most 60 lines.

```markdown
---
name: plan-forks
paths: [".rulesync/scripts/persist-plan.ts", ".grok/hooks/**"]
hits: 1
last-hit: 2026-11-01
evidence: ["plan 16"]
---

# Plan rewrites fork serials

Rewriting a saved plan minted a new serial.

## Mistake
What went wrong, concretely.

## Fix
What to do instead.
```

- `name` is the filename slug. `paths` are repo-relative globs (`**` spans dirs; `*` and `?` stay in one segment) and each must match a file that exists.
- `hits` counts occurrences. `evidence` keeps the 5 most recent plan serials or commits.
- A new lesson may leave out `hits` and `last-hit`; the save fills `1` and today.

## Index

`.repo/lessons/INDEX.md` is generated: one row per lesson with path, globs, hits, last hit, and summary, sorted by hits. Do not edit it. Every lesson save, `hit`, and `rm` rewrites it, and `bun repo sync` rewrites it too. `bun repo sync --check` fails on index drift, an invalid lesson, or a glob that matches no file.

## Write

- Write, `hit`, `rm` and `index` run inside a worktree: the plan's `{serial}-{name}` (`bun repo worktree add {serial}-{name}` if it is missing), else `lesson-{slug}`, and `/correct` uses its `correct-{slug}`. The lesson then lands with that worktree's commit and `finish` (run from the root). In the main checkout the Write is denied, `hit`, `rm` and `index` exit 1 with `the main checkout is shared: run bun repo worktree add <name> and write under <root>/.worktrees/<name>; only <root>/.tmp/ is writable here`, and the library calls return `{ ok: false, error }` with that text.
- Write the whole file. The hook validates it, renders the standard form, and reindexes; the host saves it. An Edit of a lesson is denied.
- `bun repo lessons hit <slug> --evidence <text>` counts a repeat. The same evidence counts once.
- `bun repo lessons rm <slug>` deletes a lesson and reindexes.
- `bun repo lessons index` rebuilds the index. `check` runs the checks and, like `match`, is read-only, so it runs anywhere.

## When to write

After any of these, add a `## Previous mistakes` entry to the plan. If the mistake will happen again on other tasks, run `bun repo lessons match` on the files involved first, then `hit` the matching lesson or write a new one.

- Plan feedback from the user (`/write-plan`).
- A failed Verify, or a test that failed after a fix (`/implement-plan`).
- `principle-attack-the-premise` firing (`/implement-plan`).
- An accepted `/review-plan` finding (`/write-plan`).
- Roadmap feedback, an accepted `/review-roadmap` finding (`/write-roadmap`), a child plan that changes the program, or a failed program Verify (`/implement-roadmap`). These go to the roadmap's log. Before the roadmap is `done`, each entry that outlives the program becomes a lesson with `--evidence "roadmap {n}"`.
- An operator correction (`/correct`).

At `hits: 2` the mistake is a class. `/correct` encodes it as a check (architecture, type, lint, or test), then runs `bun repo lessons rm`.

## When to read

- `bun repo lessons match <file...>` prints the lessons whose globs match, most hits first, 10 at most. Each file is matched against the lessons of the checkout that holds it: the root or a managed worktree; a file in an unmanaged linked worktree uses the checkout you run it from.
- A new plan that names a matched file must cite that lesson's path in Watch-outs, or the save is denied with the lesson listed.
- The first time a session edits a matched file, the hook adds that lesson's summary and path to the context. Each lesson is shown once per session.
- `/review-plan` reads the matched lessons and flags one that no leaf acts on.
