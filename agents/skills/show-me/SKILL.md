---
name: show-me
description: 'Restate the current proposal as a concrete before and after: commands, output, errors, files.'
---
This reply only: restate the current proposal (the plan, roadmap, or change under discussion) as a concrete before and after. Not a mode switch or session flag. After this reply, revert to output.md.

Show what the person sees, not how it works:
- Before and after, side by side or one under the other, in fenced blocks.
- The exact commands they type, the output and errors they get back, and the files that change.
- No abstractions and no internal names they did not use.
- When the plan has a Usage section, take it from there. Do not invent what it does not show.

Example Usage line:

```
Before: `notes export --json` → error: unknown flag   After: prints [{"id":1,…}]   Files: src/cli.ts, src/export.ts
```

When a reviewed plan or roadmap waits for approval, end with the exact approval block `/write-plan-deep` defines. Otherwise add nothing extra.

Slash `/show-me` only.
