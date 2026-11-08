---
name: write-plan
description: 'Write a local checklist under .tmp/repo/plans/. Then /implement-plan {n}.'
---
# write-plan

You author the plan. Persist under `.tmp/repo/plans/` via Write (hook runs `.rulesync/scripts/persist-plan.ts`). Format: `.rulesync/reference/plan-format.md`.

Empty task → ask for a task and stop.

Body starts with `PLAN_NAME: <3-6 word name>`, then Goal, Usage, Context, Constraints, Watch-outs, Steps, Verify, and `## Previous mistakes` with `(none)`. Usage shows what a person or agent types and sees once the plan lands: every new or changed command, flag, output, error message, or file, in fenced blocks, with the before for each changed one; a plan with no visible change writes `No visible change:` and why. All boxes `[ ]`. Tests: new behavior or bug → failing test leaf before impl; other behavior → test leaf right after impl; docs/rename/config/generated → skip. Verify is the end gate.

After research, pick one type from `.rulesync/reference/scope.md` ## Types. Context starts with `Task type: {name}` and `Named checks:`. Copy that row's checks into Steps or Verify, including a Read leaf for each named principle. Also copy a Read leaf for every fact in ## Facts that is true of this plan. No fact, no leaf. Verify includes a Read leaf for `principle-prove-it-works`. For `cross-cut`, Context also holds architect lite: types, signatures, module map, and the rejected shape. A named check that does not apply is a Context skip with a reason.

Before you ask the user, read `principle-never-block-on-the-human`. Ask only when the user alone can answer or the action is destructive. Before a large dump or a fan-out, read `principle-guard-the-context-window` and route the bulk through `bun repo job`.

Leaves cite repo-relative paths (`.rulesync/scripts/x.ts`): the plan's worktree `{serial}-{name}` does not exist yet, and `/implement-plan` applies the paths inside it.

Before writing, run `bun repo lessons match` on the repo-relative paths the plan names. Cite each matched lesson path in Watch-outs with what this plan does about it; the save denies a plan that leaves one out. Lessons: `.rulesync/reference/lessons.md`.

Author `commit: type(scope): subject` on its own line before persist (scope optional). Conventional Commits subject: imperative lowercase, no trailing period. Types: feat fix docs style refactor perf test build ci chore revert.

Author `strategy: default|review-fast|review-deep` on its own line beside `commit:`. `default` for a small or docs-only plan. `review-fast` for multi-phase code work. `review-deep` for cross-cut, hook or gate, or hard-to-undo work. A roadmap slice copies the roadmap's value unless its scope argues for another. Meanings: `.rulesync/reference/plan-format.md`.

The plan is the proposal and caps the result (`.rulesync/reference/scope.md`). Before writing, research until every leaf is defensible; ask any plan-shaping question the user alone can answer, then research again on the answer. Do not default a plan-shaping choice. A minor open choice goes under Constraints as the chosen default plus "confirm".

After the save, spawn a fresh host agent whose prompt is only `/review-plan {n}` and the plan's absolute path (on Claude Code the `claude` agent type; scout is not the reviewer). Accept or reject each finding with a reason. Apply accepted ones to the same plan file and add one `- review: …` entry each to `## Previous mistakes`. One review round per write or revision. Bump frontmatter `reviews` by one in the same save that settles the round, even when it had no findings; send the full frontmatter for that save. Every Write that sends full frontmatter carries the current `reviews`: the save denies one that lowers or drops it.

On feedback, revise the same file (a Write of the saved path updates it in place) and add a `- feedback: …` entry for what the user rejected and what changed. Never edit or drop an earlier entry. When the mistake will happen again on other tasks, run `bun repo lessons match` on the files involved, then `bun repo lessons hit <slug> --evidence "plan {n}"` or write a new lesson inside the plan's worktree `{serial}-{name}` (`bun repo worktree add {serial}-{name}` if it is missing), so it lands with the plan's commit, and end the entry with `(lesson: {slug})`.

Report: serial N at the absolute path the Write returned (`/…/.tmp/repo/plans/{file}`, never repo-relative), the goal, the phase list, the top risks, and any assumption to confirm. Do not dump the plan. Stop and end the reply with two lines: `Strategy: {s}, because …` in one sentence, then the closing line, `Reply "y" to run plan {n} (strategy: {s}), or "y {a}" / "y {b}".` Each `{a}` and `{b}` is a strategy other than `{s}`, in the order default, review-fast, review-deep. When other reviewed plans or roadmaps from this session wait too, it stays one line: `Reply "y" to run plan {n} (strategy: {s}), then plan {m} (strategy: {s}), then roadmap {k} (strategy: {s}), or …` in run order, where each item shows the strategy in its file and the `or` list holds every strategy that not all items hold. The Stop hook names the exact line when yours is off. Ask for approval no other way. A bare `y` approves exactly that line. `y {strategy}` approves it with that strategy, which the hook writes into each plan the line names. On feedback, revise this file, run `/review-plan` again, and stop again with the closing line. Run `/implement-plan {n}` in the same turn when the request said "plan and do it", or when `/implement-roadmap` is running a `locked` or `in-progress` roadmap. A plan-shaping question still stops.
