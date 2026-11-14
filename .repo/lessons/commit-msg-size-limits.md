---
name: commit-msg-size-limits
paths: ["cli/commit-msg.ts","cli/commit-msg.constants.ts"]
hits: 2
last-hit: 2026-11-14
evidence: ["roadmap 8","roadmap 12"]
---

# Keep the commit subject under 100 chars; add a body only past 1000 lines

## Mistake
The commit-msg hook refused a commit after verify passed: a subject over 100 chars (plan 151), and a why-line body on a 972-line commit (plan 156). A body is allowed only past 1000 changed lines.

## Fix
Keep `type(scope): subject` at 100 chars or fewer. Run `git diff --cached --shortstat`; add one `-m` why-line only when insertions plus deletions exceed 1000, else commit with the subject alone.
