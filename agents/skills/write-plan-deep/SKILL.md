---
name: write-plan-deep
description: 'Deep: write a full checklist under .repo/plans/. Then /implement-plan-deep {n}. Short one: /write-plan-fast.'
---
# write-plan-deep

You author the plan. Persist under `.repo/plans/` via Write (hook runs `cli/scripts/persist-plan.ts`). Format: `node_modules/@workerstack/repo/references/plan-format.md`.

Empty task → ask for a task and stop.

Body's first line is `PLAN_NAME: <3-6 word name>`, then the `commit:` and `strategy:` lines, `# {slug}`, and the 5-line card (`WHAT`, `WHY`, `RISK`, `TOUCH`, `DONE`, padded to 7 columns, each line ≤120 characters) that sums up Goal and Steps for a glance. Then Goal, Usage, Context, Constraints, Watch-outs, Steps, Verify, and `## Previous mistakes` with `(none)`. Usage shows what a person or agent types and sees once the plan lands: every new or changed command, flag, output, error message, or file, in fenced blocks, with the before for each changed one; a plan with no visible change writes `No visible change:` and why. All boxes `[ ]`. Tests: new behavior or bug → failing test leaf before impl; other behavior → test leaf right after impl; docs/rename/config/generated → skip. Verify is the end gate.

After research, pick one type from `node_modules/@workerstack/repo/references/scope.md` ## Types. Context starts with `Task type: {name}` and `Named checks:`. Copy that row's checks into Steps or Verify, with a Read leaf for each named principle and for every fact in ## Facts that is true of this plan. No fact, no leaf. Each Read leaf goes first in the phase it gates, never in a phase of its own. Verify includes a Read leaf for `principle-prove-it-works`. For `cross-cut`, Context also holds architect lite: types, signatures, module map, and the rejected shape. A named check that does not apply is a Context skip with a reason.

Before you ask the user, read `principle-never-block-on-the-human`. Ask only when the user alone can answer or the action is destructive. Before a large dump or a fan-out, read `principle-guard-the-context-window` and route the bulk through `bun repo job`.

Leaves cite repo-relative paths (`cli/scripts/x.ts`): the plan's worktree `{serial}-{name}` does not exist yet, and `/implement-plan-deep` applies the paths inside it. When adjacent phases write disjoint files, end each phase line with `(parallel: <path>, …)` listing every file its leaves write.

Before writing, run `bun repo lessons match` on the repo-relative paths the plan names. Cite each matched lesson path in Watch-outs with what this plan does about it; the save denies a plan that leaves one out. Lessons: `node_modules/@workerstack/repo/references/lessons.md`.

Author `commit: type(scope): subject` on its own line before persist (scope optional). Conventional Commits subject: imperative lowercase, no trailing period. Types: feat fix perf refactor test docs build ci chore revert.

Omit the `strategy:` line to take `agents.defaultStrategy`. Author `strategy: free|spawn-fast|spawn-deep` on its own line beside `commit:` only when the plan's scope argues for another value. `free` for a small or docs-only plan. `spawn-fast` for multi-phase code work. `spawn-deep` for cross-cut, hook or gate, or hard-to-undo work. A roadmap slice copies the roadmap's value unless its scope argues for another. Meanings: `node_modules/@workerstack/repo/references/plan-format.md`.

Author `mode: away` on its own line beside `strategy:` only when this session runs `/away`, and `mode: ask|away` only when the person asked for that mode. Otherwise send no `mode:` line. A session stamp beats a saved `mode:`; under away the Stop hook runs the approval block's `i` once the review settles, so do not wait for `y`.

The plan is the proposal and caps the result (`node_modules/@workerstack/repo/references/scope.md`). A plan over 100 lines above `## Previous mistakes`, frontmatter included, is two or more slices: write a roadmap (`/write-roadmap-deep`) instead. Before writing, research until every leaf is defensible; ask any plan-shaping question the user alone can answer, then research again on the answer. Do not default a plan-shaping choice. A minor open choice goes under Constraints as the chosen default plus "confirm".

After the save, spawn a fresh host agent whose prompt is only `/review-plan {n}` and the plan's absolute path (on Claude Code the `claude` agent type; scout is not the reviewer). Accept or reject each finding with a reason. Apply accepted ones to the same plan file and add one `- review: …` entry each to `## Previous mistakes`. One review round per write or revision. Bump frontmatter `reviews` by one in the same save that settles the round, even when it had no findings; send the full frontmatter for that save. Every Write that sends full frontmatter carries the current `reviews`: the save denies one that lowers or drops it.

On feedback, revise the same file (a Write of the saved path updates it in place) and add a `- feedback: …` entry for what the user rejected and what changed. Never edit or drop an earlier entry. When the mistake will happen again on other tasks (Write a lesson only for a mistake our normal workflow will hit again on other tasks. A one-time issue stays in the plan's Previous mistakes.), run `bun repo lessons match` on the files involved, then `bun repo lessons hit <slug> --evidence "plan {n}"` or write a new lesson inside the plan's worktree `{serial}-{name}` (`bun repo worktree add {serial}-{name}` if it is missing), so it lands with the plan's commit, and end the entry with `(lesson: {slug})`.

Report: serial N at the absolute path the Write returned (`/…/.repo/plans/{file}`, never repo-relative), the goal, the phase list, the top risks, and any assumption to confirm. Do not dump the plan. End with the approval block only after the review settled: `reviews` was bumped in the save after the review spawn. Before that the Stop hook blocks it, and an `i` or `h` on an unsettled item is refused. Stop and end the reply with this block, fenced as code, with nothing after it:

```
plan {n} · {s}
  i  implement    if · isf · isd
  h  hand off     hf · hsf · hsd
     or reply to revise
```

`{s}` is the strategy in the plan's file. When other reviewed plans or roadmaps from this session wait too, the header names each in run order, joined with `, then ` (`plan {n} · {s}, then roadmap {k} · {s}`). The rows never change. The Stop hook names the exact block when yours is off. Ask for approval no other way. `i`, or a reply that is only `y`, `yes`, `go` or `do it`, approves the block with each file's strategy. `if`, `isf` and `isd` approve it with `free`, `spawn-fast` or `spawn-deep`, which the hook writes into each item first. `h` hands the whole block to a fresh session with each file's strategy; `hf`, `hsf` and `hsd` write a strategy first. Codes match exactly. A spelled-out reply such as `implement fere` or `hand of fast` counts as the one action and strategy it is within two edits of. A near-miss code (`isx`) or a word close to several choices brings the block back, and any other reply is feedback. After a handoff the hook writes one handoff for the block; tell the person to run the `/pickup {serial}` it names in a fresh session, and do no work here. On feedback, revise this file, run `/review-plan` again, and stop again with the approval block. Run `/implement-plan-deep {n}` in the same turn when the request said "plan and do it", or when `/implement-roadmap-deep` is running a `locked` or `in-progress` roadmap. A plan-shaping question still stops.
