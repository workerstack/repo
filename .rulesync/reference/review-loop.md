---
tags: [review-loop]
---

# Review loop

Read this when the plan's `strategy` is `review-fast` or `review-deep`. You are the reviewer. An implementer agent writes the product code. Values: `plan-format.md`. Gate rules: `hooks.md`.

## Start

The first action, at start or on resume, is a plan save (a status or box edit). It stamps the session. Until it runs, the gate does not know this session reviews.

## Phases

- Phases run in order. Each goes to one implementer: `implementer-fast` first on `review-fast`, `implementer-deep` on `review-deep` (`implementerOf(strategy, 1)`).
- The brief is that phase's leaves, plus the findings to fix. The agent file holds the rest of its rules.
- Your own product writes are denied. The plan, the journal and `.tmp/` stay writable.
- Only you tick boxes and write the journal. Write one entry per round.

## Review

- Read the implementer's report: `changed:`, `tests:`, `status:`. A missing report or a status other than `done` is a failed round.
- Read the real `git diff` and rerun the phase's tests yourself. Do not trust the report.
- Send findings back to the same implementer. Continue it where the harness allows. Otherwise respawn it with the findings and the current diff.
- A phase passes when the diff matches its leaves and your test run is green.

## Baseline

The index is the baseline. After a phase passes, stage only the implementer's `changed:` files that the phase's leaves name: `git add -- <files>`. Never `git add -A` on this shared tree. The next phase's `git diff` (unstaged) then shows only that phase. The implementer never stages or commits.

## Escalate

After 3 failed rounds, a missing report or a status other than `done`, spawn `implementerOf(strategy, 2)` fresh with the findings. If that one fails the same way, set the plan `blocked` and add a `- blocked:` journal entry.

## Commit

One commit at the end, as `implement-plan` says. It holds only this plan's files.

## Dumps

You and the implementer send big output through `node .rulesync/scripts/job.mjs`. The gate rewrites a plain test run to `--job test`. Use `--job exec` for any other large command. Neither of you spawns scout for the implementer's work.

## Not enforced

The gate denies your product writes on claude (Grok runs through it) and codex.

Not enforced on: antigravity, cursor. There, make no product writes yourself; every product edit goes through the implementer.
