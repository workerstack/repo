---
name: heading-scan-skips-fences
paths: ["cli/scripts/persist-sections.ts","cli/scripts/persist-fast-validate.ts","cli/scripts/persist-mistakes.ts"]
hits: 1
last-hit: 2026-11-13
evidence: ["plan 174"]
---

# A Markdown heading scan must skip fenced code

## Mistake
The fast plan line cap took a `## Previous mistakes` inside a fenced block as the real heading. It stopped counting there, so a plan over the cap passed (plan 174).

## Fix
Find headings with `lastHeadingIndex` or another helper in `persist-sections.ts` that skips fenced lines. Give every new section reader a test row with the heading inside a fence.
