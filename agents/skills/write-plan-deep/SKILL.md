---
name: write-plan-deep
description: 'Deep: write a full checklist under .repo/plans/. Then /implement-plan-deep {n}. Short one: /write-plan-fast.'
---
# write-plan-deep

You author the plan. Persist under `.repo/plans/` via Write (hook runs `cli/scripts/persist-plan.ts`). Format: `node_modules/@workerstack/repo/references/plan-format.md`.

Empty task → ask for a task and stop.

Body's first line is `PLAN_NAME: <3-6 word name>`, then the `commit:` and `advice:` lines, `# {slug}`, and the 5-line card (`WHAT`, `WHY`, `RISK`, `TOUCH`, `DONE`, padded to 7 columns, each line ≤120 characters) that sums up Goal and Steps for a glance. Then Goal, Usage, Context, Constraints, Watch-outs, Steps, Verify, and `## Previous mistakes` with `(none)`. Usage shows what a person or agent types and sees once the plan lands: every new or changed command, flag, output, error message, or file, in fenced blocks, with the before for each changed one; a plan with no visible change writes `No visible change:` and why. All boxes `[ ]`. Tests: new behavior or bug → failing test leaf before impl; other behavior → test leaf right after impl; docs/rename/config/generated → skip. Verify is the end gate.

After research, pick one type from `node_modules/@workerstack/repo/references/scope.md` ## Types. Context starts with `Task type: {name}` and `Named checks:`. Copy that row's checks into Steps or Verify, with a Read leaf for each named principle and for every fact in ## Facts that is true of this plan. No fact, no leaf. Each Read leaf goes first in the phase it gates, never in a phase of its own. Verify includes a Read leaf for `principle-prove-it-works`. For `cross-cut`, Context also holds architect lite: types, signatures, module map, and the rejected shape. A named check that does not apply is a Context skip with a reason.

Before you ask the user, read `principle-never-block-on-the-human`. Ask only when the user alone can answer or the action is destructive. Before a large dump or a fan-out, read `principle-guard-the-context-window` and route the bulk through `bun repo job`.

Leaves cite repo-relative paths (`cli/scripts/x.ts`): the plan's worktree `{serial}-{name}` does not exist yet, and `/implement-plan-deep` applies the paths inside it. When adjacent phases write disjoint files, end each phase line with `(parallel: <path>, …)` listing every file its leaves write.

Before writing, run `bun repo lessons match` on the repo-relative paths the plan names. Cite each matched lesson path in Watch-outs with what this plan does about it; the save denies a plan that leaves one out. Lessons: `node_modules/@workerstack/repo/references/lessons.md`.

Author `commit: type(scope): subject` on its own line before persist (scope optional). Conventional Commits subject: imperative lowercase, no trailing period. Types: feat fix perf refactor test docs build ci chore revert.

Never write a `strategy:` line: the save sets it from the session value (`/set`, `bun repo set`), then for a plan the newest in-progress roadmap this session saved, then `agents.defaultStrategy`, then `free`; a line that differs from the saved value is denied. Send `advice: {free|spawn-fast|spawn-deep} because {reason}` (at most 100 characters) on its own line beside `commit:` with the value the plan's scope argues for; the person picks at approval. `free` for a small or docs-only plan. `spawn-fast` for multi-phase code work. `spawn-deep` for cross-cut, hook or gate, or hard-to-undo work. A roadmap slice advises its roadmap's value unless its scope argues for another. Meanings: `node_modules/@workerstack/repo/references/plan-format.md`.

Author `approval: away` on its own line beside `advice:` only when this session runs `/away`, and `approval: ask|away` only when the person asked for that approval. Otherwise send no `approval:` line. A session approval beats a saved `approval:`; under away the Stop hook runs the approval block's `i` once the review settles, so do not wait for `y`.

The plan is the proposal and caps the result (`node_modules/@workerstack/repo/references/scope.md`). A plan over 100 lines above `## Previous mistakes`, frontmatter included, is two or more slices: write a roadmap (`/write-roadmap-deep`) instead. Before writing, research until every leaf is defensible; ask any plan-shaping question the user alone can answer, then research again on the answer. Do not default a plan-shaping choice. A minor open choice goes under Constraints as the chosen default plus "confirm".

`hold review` after the task (`/implement-roadmap-deep` says it for a parallel group's plan): skip the spawn below and report the plan; the runner sends every group plan's review in one message, and you settle each round as below.

After the save, spawn a fresh host agent whose prompt is only `/review-plan {n}` and the plan's absolute path (on Claude Code the `claude` agent type; scout is not the reviewer). Accept or reject each finding with a reason. Apply accepted ones to the same plan file and add one `- review: …` entry each to `## Previous mistakes`. One review round per write or revision. Bump frontmatter `reviews` by one in the same save that settles the round, even when it had no findings; send the full frontmatter for that save. Every Write that sends full frontmatter carries the current `reviews`: the save denies one that lowers or drops it.

On feedback, revise the same file (a Write of the saved path updates it in place) and add a `- feedback: …` entry for what the user rejected and what changed. Never edit or drop an earlier entry. When the mistake will happen again on other tasks (Write a lesson only for a mistake our normal workflow will hit again on other tasks. A one-time issue stays in the plan's Previous mistakes.), run `bun repo lessons match` on the files involved, then `bun repo lessons hit <slug> --evidence "plan {n}"` or write a new lesson inside the plan's worktree `{serial}-{name}` (`bun repo worktree add {serial}-{name}` if it is missing), so it lands with the plan's commit, and end the entry with `(lesson: {slug})`.

Report: serial N at the absolute path the Write returned (`/…/.repo/plans/{file}`, never repo-relative), the goal, the phase list, the top risks, and any assumption to confirm. Do not dump the plan. End with the approval block only after the review settled: `reviews` was bumped in the save after the review spawn. Before that the Stop hook blocks it, and an `i` or `h` on an unsettled item is refused. Stop and end the reply with this block, fenced as code, with nothing after it:

```
plan {n} · {s}
  plan {n} advice: {advice}
  i  implement    i free · i fast · i deep
  h  hand off     h free · h fast · h deep
     or reply to revise
```

`{s}` is the strategy in the plan's file. When other reviewed plans or roadmaps from this session wait too, the header names each in run order, joined with `, then ` (`plan {n} · {s}, then roadmap {k} · {s}`). Each plan or roadmap whose file has `advice:` gets one advice row right under the header, in header order, with the text from the file; an item with no advice has no row. The fixed rows never change. The Stop hook names the exact block when yours is off, and it blocks an advice row that differs from the file's. Ask for approval no other way. On Claude Code the Stop hook may instead name an approval picker: call AskUserQuestion with exactly the input it gives, then act on the answer's context. An answer that is no option's label is feedback: revise this file, run `/review-plan` again, and stop for approval again. Codex, Cursor, Antigravity, Grok and away keep the typed block. `i`, or a reply that is only `y`, `yes`, `go` or `do it`, approves the block with each file's strategy. `i free`, `i fast` and `i deep` approve it with `free`, `spawn-fast` or `spawn-deep`, which the hook writes into each item first and then keeps as the session strategy. `h` hands the whole block to a fresh session with each file's strategy; `h free`, `h fast` and `h deep` write a strategy first and leave the session alone. The old letter codes (`if`, `isf`, `isd`, `hf`, `hsf`, `hsd`) are gone: each brings the block back with `"{reply}" is not a choice; reply i or h, alone or with free, fast or deep; end with this block again:`. A spelled-out reply such as `implement fere` or `hand of fast` counts as the one action and strategy it is within two edits of. A word close to several choices brings the block back, and any other reply is feedback. After a handoff the hook writes one handoff for the block; tell the person to run the `/pickup {serial}` it names in a fresh session, and do no work here. On feedback, revise this file, run `/review-plan` again, and stop again with the approval block. Run `/implement-plan-deep {n}` in the same turn when the request said "plan and do it", or when `/implement-roadmap-deep` is running a `locked` or `in-progress` roadmap. A plan-shaping question still stops.
