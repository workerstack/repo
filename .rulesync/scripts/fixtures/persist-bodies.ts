// Valid bodies for each persist kind, shared by the persist suites and the hook suite.
export const VALID_PLAN = `PLAN_NAME: add tmp ignore
strategy: default

# add-tmp-ignore

WHAT   .gitignore ignores .tmp/ so plans stay untracked
WHY    plans under .tmp/repo/plans/ must never land in a commit
RISK   existing ignore lines must survive
TOUCH  .gitignore
DONE   git check-ignore reports .tmp/repo/plans

## Goal
Repo .gitignore ignores .tmp/ so files under .tmp/repo/plans/ stay untracked. Existing ignore entries stay.

## Usage
Before:

\`\`\`console
$ git check-ignore -v .tmp/repo/plans
\`\`\`

After:

\`\`\`console
$ git check-ignore -v .tmp/repo/plans
.gitignore:1:.tmp/	.tmp/repo/plans
\`\`\`

## Context
- Plans live under .tmp/repo/plans/

## Constraints
- Do not clobber other .gitignore lines

## Watch-outs
- Duplicate .tmp/ if append without grep

## Steps
1 [ ] gitignore
1.1 [ ] read the gitignore if it exists
1.2 [ ] append .tmp/ when absent

## Verify
2 [ ] Verify
2.1 [ ] git check-ignore reports ignored

## Previous mistakes
(none)
`;

// A new roadmap: the card, one line per slice, Verify and Previous mistakes.
export const DRAFT_ROADMAP = `ROADMAP_NAME: auth program
strategy: default

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
3.1 [ ] both slices are done

## Previous mistakes
(none)
`;

// A roadmap in the shape saved before pointer roadmaps: Goal, Usage, Context, Decisions, three lines per slice.
export const LEGACY_ROADMAP = `ROADMAP_NAME: auth program
strategy: default

# auth-program

## Goal
Ship auth as two plans. The second plan waits on the first. Names stay reserved.

## Usage
Before:

\`\`\`console
$ repo init
reserved skills: commit, review
\`\`\`

After:

\`\`\`console
$ repo init
reserved skills: commit, review, auth-types
\`\`\`

## Context
- Init owns reserved names

## Decisions
- D1. Fetch stays upstream. Rejected: a vendored snapshot.

## Order
1 [ ] Title: auth types
      Goal: Reserved names list the new skills.
      Why: Later slices add skills. This slot keeps init and INDEX together.
2 [ ] Title: commit diff pass
      Goal: Commit skills strip narrating comments.
      Why: Every later land goes through commit.

## Watch-outs
- Hook ignores docs until wired

## Verify
3 [ ] Verify
3.1 [ ] both slices are done

## Previous mistakes
(none)
`;

export const VALID_HANDOFF = `HANDOFF_NAME: sync skills to hosts

# sync-skills-to-hosts

## Goal
Ship /handoff as a skill on every host. Claude links resolve to the source.

## State
- \`.agents/skills/handoff/SKILL.md\` written
- \`.rulesync/scripts/persist-handoff.ts\` green

## Context
- SSOT: /repo/.agents/skills/
- Claude link: /repo/.claude/skills/

## Next
1 [ ] wire generate
1.1 [ ] add -f skills to rulesync:generate
1.2 [ ] add -f skills to rulesync:check

## Watch-outs
- grokcli has no skills target
`;

export const VALID_IMPL = `IMPL_NAME: add tmp ignore
IMPL_PLAN: 6

# add-tmp-ignore

## Done
(none)

## Issue
(none)

## Files
(none)

## Log
(none)

## Blockers
(none)

## Notes
(none)
`;

export const VALID_TMP = `TMP_NAME: bank email draft
TMP_EXT: md

Subject: hello

Please send the statement.
`;

export const VALID_LESSON = `---
name: plan-forks
paths: ["src/**"]
hits: 1
last-hit: 2026-10-31
evidence: ["plan 16"]
---

# Plan rewrites fork serials

Rewriting a saved plan minted a new serial.

## Mistake
A full-body Write to a saved plan went through the create path.

## Fix
Update the saved file in place and keep its serial.
`;
