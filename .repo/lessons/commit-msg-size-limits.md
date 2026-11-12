---
name: commit-msg-size-limits
paths: ["cli/commit-msg.ts","cli/commit-msg.constants.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# commit-msg caps the header and ties the body to the size limit

The commit-msg hook refused commits after the full verify had already passed.

## Mistake
Plan 151's commit subject ran past 100 characters, and the hook refused the header. Plan 156 added a why-line body to a 972-line commit, and the hook refused it with "remove the body". A body is allowed only on commits over the 1000-line limit.

## Fix
Keep `type(scope): subject` at 100 characters or fewer. Run `git diff --cached --shortstat` before committing, and add exactly one `-m` why-line only when insertions plus deletions exceed 1000. Otherwise commit with the subject alone.
