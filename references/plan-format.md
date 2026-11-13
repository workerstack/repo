---
description: Plan file format
---

# Plan format (SSOT)

Local session checklist. Not a design doc, PR stack, or DAG.

## Path

`.repo/plans/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`

- **serial:** unpadded decimal int only (`1`, `12`, `10000`). **Never** `0001`, never quoted `"0001"` / `"1"`. Serial ≥ 1.
- **filename:** unpadded serial, slug, UTC datetime stamp (`6-sync-global-settings-20260826T143000Z.md`, not `0001-slug.md`). Stamp is `created` with `-` and `:` dropped (keep `T` and `Z`).
- **lookup:** integer equality on leading digits (`1` matches `1-foo-20260826T143000Z.md` and legacy `1-foo.md`; also `0001-foo.md` if an old padded file still exists).
- **valid filename (new):** `^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.md$`
- **valid filename (legacy):** `^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*\.md$` (no stamp; still accepted for existing files)
- Frontmatter line must match `^serial: [1-9][0-9]*$`. Leading zeros are invalid (YAML octal / VS Code warning).
- **New writes** always use the stamped filename. Collision: increment serial, rebuild filename, same stamp.

## Slugify (`PLAN_NAME`)

Send `PLAN_NAME: <name>` as the body's first line. The save reads the name from it and drops the line wherever it sits above the first `##` outside a code fence, so a body that opens with `commit:` or `strategy:` lines still saves with the card right under the title. A `PLAN_NAME:` line inside a fence or below the first `##` stays as text.

1. lower
2. non `[a-z0-9]` → `-`
3. collapse `-`, strip edges
4. trim to 50 chars; if cut on `-`, strip trailing `-`
5. empty → `unnamed`
6. strip trailing `.lock` if any

## Allocate next serial (repo, bash)

```bash
mkdir -p .repo/plans
next=1
for f in .repo/plans/*; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  case "$b" in
    [0-9]*.md) n=${b%%-*}; n=$((10#$n)); [ "$n" -ge "$next" ] && next=$((n+1));;
  esac
done
# filename prefix: unpadded decimal "$next" (1, 12, 10000)
```

Collision: if target path exists, increment and retry (max 5).

## Frontmatter (required)

```yaml
---
serial: 1
name: add-auth
status: ready          # ready | in-progress | done | blocked
reviews: 0             # settled /review-plan rounds; never lowered or removed
created: 2026-08-26T14:30:00Z    # UTC ISO-8601 seconds + Z; no milliseconds
source: "<≤120 chars of user task>"
commit: feat: <subject>
strategy: default      # default | review-fast | review-deep
mode: away             # optional: ask | auto | away
---
```

`name` is the slug only (no datetime). `source` ≤120 chars.

`strategy` is required. It says how the plan gets implemented:

- `default`: the main session does the work, as it always has. No extra rules apply.
- `review-fast`: the main session only reviews. Each phase goes to the `implementer-fast` agent. The reviewer reads the real diff, reruns the tests and sends findings back. A second attempt goes to `implementer-deep`.
- `review-deep`: the same loop, with `implementer-deep` from the first attempt.

A save with no `strategy` or an unknown value is denied with `strategy: default|review-fast|review-deep`. A body line `strategy: {value}` moves into the frontmatter after `commit:`, like `commit:`. A line inside a code fence is not moved. The person can change the value with `y <strategy>` when approving, or `h fast` / `h deep` when handing off.

`mode` is optional: `ask`, `auto` or `away`. While the plan is `in-progress`, its `mode` wins over the session's `/ask` or `/away` flag, for the session that saved it only. `/write-plan` writes it only when the session runs `/away` or the person asked for a mode. A body line `mode: {value}` moves into the frontmatter after `strategy:`, like `strategy:`; a line inside a code fence is not moved. Another value is denied with `mode: ask|auto|away`.

`reviews` counts the `/review-plan` rounds whose findings the writer settled: a whole number with no sign or leading zero, `0` on a new plan. The writer bumps it in the same save that applies a round's findings, even a round with no findings. It never goes down, and once present it cannot be removed, so every Write that sends full frontmatter carries the current `reviews`. The count proves a round ran and was settled, not that the review was good.

`created` for **new writes:** `new Date().toISOString()` with milliseconds stripped (`.\d{3}Z` → `Z`), e.g. `2026-08-26T14:30:00Z`. Existing files may still have `created: YYYY-MM-DD`.

### Status machine

`ready` → `in-progress` → `done` | `blocked`

- Fresh write: `ready`
- Implement start: `in-progress`, only with `reviews` ≥ 1. The save denies the move with `reviews: 0`, and a missing `reviews` counts as 0. A plan already `in-progress` without the key stays editable
- All boxes `[x]`: `done`
- Cannot finish: `blocked` (leave remaining `[ ]`)

## Body headings (this order only)

`# {slug}`, the card, `## Goal`, `## Usage`, `## Context`, `## Constraints`, `## Watch-outs`, `## Steps`, `## Verify`, `## Previous mistakes`

No other `##` headings. A plan saved before `## Usage` or `## Previous mistakes` existed stays valid without them; a fresh save needs both. Lines inside a code fence are never headings or checkboxes. No PR Plan, Key Decisions, or DAG.
No required Why heading. Optional why footnote only (not a `##`). Pick2 file plan stays how-first; missing Why heading does not block.

## Card

The 5 lines a person reads first: right after `# {slug}` and one blank line, then a blank line before `## Goal`.

```markdown
WHAT   notes export --json prints a JSON array
WHY    scripts parse notes without the table
RISK   empty notebook must print []
TOUCH  src/cli.ts, src/export.ts (+ test)
DONE   bun run test; --json | JSON.parse ok
```

- Labels `WHAT`, `WHY`, `RISK`, `TOUCH`, `DONE`, in that order, each padded to 7 columns so the text starts at column 8. The text is never empty.
- Each line is at most 120 characters.
- The card sums up Goal and Steps for a person reviewing at a glance. It does not replace `## Goal`, which tools and `/review-plan` read.
- Fresh writes only. An update to a plan saved without a card stays valid.
- Each failing line has its own deny: `start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE`, `card line 2 must start with WHY`, `card line 4 (TOUCH) is 131 characters; the limit is 120`.

## Size

At most 100 lines above `## Previous mistakes`, frontmatter included. More than that is two or more slices: write a roadmap with `/write-roadmap`. A fresh save over the cap is denied with `131 lines above ## Previous mistakes, the cap is 100; split it into a roadmap (/write-roadmap)`. An update over 100 lines is denied only when it is longer than the saved file, so a legacy plan can still flip boxes. `## Previous mistakes` never counts: it grows during the run.

## Previous mistakes

This plan's own log of what went wrong. Last heading, after Verify, no checkboxes. A new plan writes `(none)`.

- Entry: `- {source}: {what was wrong} → {what changed}`, optionally ending ` (lesson: {slug})`.
- `source`: `feedback` (the user sent the plan back), `verify` (a Verify or test failed after a fix), `review` (an accepted `/review-plan` finding), `premise` (an assumption turned out wrong), `decision` (a choice made under away instead of asking).
- A decision entry is `- decision: {question} → {choice}, because {why}`.
- Append-only. A save that edits or drops an existing entry is denied and names the entry.
- An entry that will happen again on other tasks also becomes a lesson: `node_modules/@workerstack/repo/references/lessons.md`.

## Revisions

A Write of a saved plan updates that file: same path, serial, and `created`. The given `status` and `[x]` boxes are kept. A body without frontmatter keeps the saved frontmatter. An Edit of a saved plan is checked against the text it would produce and runs as sent when valid. Never save a revision as a new plan.

## Checkbox grammar

- Open: `[ ]` (space in box required)
- Done: `[x]` (accept `[X]`, write `[x]`)
- Line: `^{id} [ ] {text}$` with optional 0–2 space indent
- `{id}` = `N` / `N.M` / `N.M.K` (digits + dots). **Not** `1. [ ]`. **Not** GitHub `- [ ]`
- Fresh plans: all `[ ]`, never `[x]`
- Marking done: only flip the box. No renumber, delete, or rewrite leaf text
- Depth 2 default (`N` phase + `N.M` leaf). 3rd level only if a leaf would itself be a mini-plan
- Every phase `N` has ≥1 leaf `N.M`. The session agent **executes leaves**. Roll up: all children `[x]` ⇒ parent `[x]`
- Verify = last numbered phase, same grammar
- A Read leaf (``N.M [ ] read `principle-…` ``) sits in the phase it gates, before the leaves it governs. A phase whose every leaf reads a principle gates nothing and is denied on a fresh write: `phase 1 only reads principles; move each read into the phase it gates`. An update is denied only when the saved file had no such phase. Verify reads `principle-prove-it-works` beside its command leaves
- Done plan: every checkbox `[x]`, `status: done`

## Parallel phases

A phase line may end `(parallel: <path>, <path>, …)`, listing every file its leaves write, repo-relative and comma-separated:

```markdown
2 [ ] Parser (parallel: src/parse.ts, src/parse.test.ts)
2.1 [ ] add the parser in src/parse.ts
3 [ ] Printer (parallel: src/print.ts, src/print.test.ts)
3.1 [ ] add the printer in src/print.ts
```

- Adjacent parallel phases form a group whose phases can run at the same time. A group needs two or more phases, and no two of its lists may share a path.
- Paths are compared as written, never resolved on disk; `\` reads as `/`, so `src\cli.ts` and `src/cli.ts` are the same path.
- Denies: `parallel phases 2 and 3 both list src/cli.ts; parallel phases need disjoint files`, `phase 4 is parallel alone; parallel needs two or more adjacent phases`, `phase 2 is parallel with no files; list the files it writes after parallel:`.
- Under a review strategy a group runs at once as `references/review-loop.md` says; `bun repo phase-files <plan> <phases>` checks that each phase wrote only its list.
- Every path a parallel phase's leaves name sits in its list. The save cannot see that; `/review-plan` checks it.

## Prose vs steps

| Section | Amount |
|---|---|
| Goal | 1–3 sentences. What “done” means. |
| Usage | What a person or agent types and sees once the plan lands: each new or changed command, flag, output, error message, or file, in fenced blocks, with the before for each changed one. Internal steps nobody types or reads need none. A plan with no visible change writes one line: `No visible change:` and why. |
| Context / Constraints / Watch-outs | bullets only. Watch-outs: non-obvious footguns; empty allowed (`(none)`). A new plan that names a file a lesson matches cites that lesson path in Watch-outs, or the save is denied. Context includes `Task type:`, `Named checks:` from `node_modules/@workerstack/repo/references/scope.md` ## Types, and a skip-with-reason when a named check is dropped. |
| Steps | bulk of the file; each leaf = one coherent edit or one file-level action |
| Verify | 1–5 runnable leaves (cmd or observable) |

Tests live in Steps (not a new heading). New behavior or a bug: a failing test leaf before the impl leaf. Other behavior change: a test leaf immediately after the impl leaf. Docs, rename-only, config-only, generated: no test leaf. Verify is the end gate (project cmd or named subset), not a substitute for those leaves. Do not re-run the whole suite after every leaf unless it is cheap.

Thinker cites **repo-relative paths** (`cli/scripts/x.ts`). The plan's worktree `{serial}-{name}` does not exist until the serial is saved, so `/implement-plan` applies each path inside that worktree; an absolute path under the root is accepted too and names the same path there. Leaves must be implementable without re-planning. Product fork → pick the narrowest default, state it under Constraints, still emit steps.

## Validation checklist

- filename matches new stamped regex or legacy unstamped; new writes unpadded + stamp (`1-foo-20260826T143000Z.md` not `0001-foo.md`); serial int equals leading digits; `name` equals slug after stripping optional trailing `-\d{8}T\d{6}Z`
- frontmatter `serial` line matches `^serial: [1-9][0-9]*$` (unpadded decimal ≥ 1; reject `0001`, `"0001"`, `0`, `01`)
- frontmatter keys: `serial`, `name`, `status`, `reviews`, `created`, `source`, `strategy`. `strategy` is required and is `default`, `review-fast` or `review-deep`; a save without it, or with another value, is invalid. Optional `mode` is `ask`, `auto` or `away`; another value is invalid. `reviews` matches `^(0|[1-9][0-9]*)$`, is `0` on a fresh write, is not lowered or removed on an update, and is ≥ 1 for a change into `in-progress`; a legacy plan without it stays valid. Optional `commit:` is a Conventional Commits subject (`type(scope): subject`, scope optional, imperative lowercase, no trailing period). A new plan includes it. A plan with no `commit` key stays valid. A present `commit` that is not that subject is invalid
- `status` ∈ `ready` | `in-progress` | `done` | `blocked`; `created` `YYYY-MM-DDTHH:MM:SSZ` (new writes) or legacy `YYYY-MM-DD`; `source` ≤120
- headings in order only; no extra `##`; `## Usage` right after `## Goal`, required on a fresh write and optional on an update to a plan saved without it, holding a fenced block or a `No visible change:` line; lines inside code fences are never headings or checkboxes; `## Previous mistakes` last and required on a fresh write, entries valid and append-only on an update; fresh write cites every matched lesson in Watch-outs; no required Why heading (optional footnote only)
- ≥1 `N.M [ ]` leaf; every phase has ≥1 leaf; Verify is last numbered phase
- `PLAN_NAME:` dropped wherever it sits above the first `##` outside a fence
- ≤100 lines above `## Previous mistakes`, frontmatter included; an update over 100 only when no longer than the saved file
- no phase whose every leaf reads a principle, on a fresh write or on an update whose saved file had none
- `(parallel: …)` phases come in adjacent groups of two or more, each with a non-empty list, lists disjoint after `\` → `/`
- checkbox grammar (`N [ ]` / `N.M [ ]` / `N.M.K [ ]`); no `- [ ]`; no `1. [ ]`
- fresh write: the card right after `# {slug}` and one blank line, `WHAT` `WHY` `RISK` `TOUCH` `DONE` in order, padded to 7 columns, text non-empty, each line ≤120 characters; zero `[x]` / `[X]`; Goal 1–3 sentences; Context/Constraints/Watch-outs bullets; Context includes `Task type:`, `Named checks:`, and a skip-with-reason when a named check is dropped; frontmatter includes `commit:` and `strategy:`; Verify 1–5 leaves

## Worked example

File: `.repo/plans/1-notes-export-json-20260826T143000Z.md`

````markdown
---
serial: 1
name: notes-export-json
status: ready
reviews: 0
created: 2026-08-26T14:30:00Z
source: "add --json to notes export"
commit: feat(notes): add --json to notes export
strategy: default
---

# notes-export-json

WHAT   notes export --json prints every note as one JSON array
WHY    scripts read notes without parsing the text table
RISK   an empty notebook must print [], and the table stays the default
TOUCH  src/cli.ts, src/export.ts (+ test)
DONE   bun run test passes; notes export --json | JSON.parse exits 0

## Goal
`notes export --json` prints every note as one JSON array on stdout, so scripts read notes without parsing the text table. The text table stays the default.

## Usage
Before:

```console
$ notes export --json
error: unknown flag --json
```

After:

```console
$ notes export --json
[{"id":1,"title":"groceries","updated":"2026-08-26T14:00:00Z"}]
$ notes export
1  groceries  2026-08-26 14:00
```

## Context
- Task type: feature
- Named checks: failing test before impl; read `principle-test-behavior-not-implementation`
- `/home/dev/Development/example-app/src/cli.ts` parses flags; `/home/dev/Development/example-app/src/export.ts` prints the table
- Rejected: a separate `notes json` command, which splits one export into two

## Constraints
- Keys are `id`, `title`, `updated`, in that order; `updated` is ISO 8601 UTC
- No new dependency

## Watch-outs
- An empty notebook prints `[]`, not nothing

## Steps
1 [ ] Failing test
1.1 [ ] read `principle-test-behavior-not-implementation`
1.2 [ ] in `/home/dev/Development/example-app/src/export.test.ts`, `notes export --json` on two notes prints a two-element array with those keys, and on none prints `[]`
1.3 [ ] run `bun run test export`; the new cases fail on the unknown flag
2 [ ] Implement
2.1 [ ] parse `--json` in `/home/dev/Development/example-app/src/cli.ts`
2.2 [ ] in `/home/dev/Development/example-app/src/export.ts`, print `JSON.stringify` of the notes when `--json` is set
2.3 [ ] run the test from 1.3; all pass

## Verify
3 [ ] Verify
3.1 [ ] read `principle-prove-it-works`
3.2 [ ] `bun run test` passes
3.3 [ ] `notes export --json | node -e "JSON.parse(require('fs').readFileSync(0, 'utf8'))"` exits 0

## Previous mistakes
(none)
````
