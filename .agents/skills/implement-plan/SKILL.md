---
name: implement-plan
description: 'Execute remaining leaves in a .tmp/grunt/plans checklist. Skip [x].'
---
# implement-plan

You execute the plan in this session. Skip `[x]`. Start at the first open leaf. Flip only the box after each leaf. When a phase's children are `[x]`, mark the phase `[x]`. Frontmatter `in-progress` then `done`.

Arg `{n|path}` picks that file. Empty arg: unique in-progress, else unique ready, else list serials.

Format: `.rulesync/reference/plan-format.md`. Write-allowlist = paths listed in the plan. Run Verify leaves. Fat dumps go through `node scripts/grunt-job.mjs`.
