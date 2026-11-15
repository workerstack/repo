---
name: ts7-api-one-read-at-a-time
paths: ["cli/ts-api.ts","cli/check-rejections.ts","cli/guard-diagnostics.ts","cli/release/api-diff*.ts"]
hits: 1
last-hit: 2026-11-15
evidence: ["roadmap 17"]
---

# Read TypeScript 7's API through cli/ts-api.ts, one read at a time

## Mistake
TS 7's unstable API broke code that followed the 5.9 habits: two reads at once on one API left a handle that kept bun alive, getAliasedSymbol on a non-alias panicked tsgo, unstable/sync failed under bun, and opening a project parsed every source file.

## Fix
Go through withTsApi and withFiles in cli/ts-api.ts, and await each read before the next. Call getAliasedSymbol only under SymbolFlags.Alias. Open only the files you need with withFiles, not the whole project. Copy cli/check-rejections.ts or cli/guard-diagnostics.ts.
