---
name: posix-only-path-parsing
paths: [".rulesync/scripts/persist-*.mjs",".rulesync/scripts/lessons.mjs",".grok/hooks/orchestrate-parent.js"]
hits: 1
last-hit: 2026-11-01
evidence: ["v0.13.0 test-windows"]
---

# Path parsing that only knows `/` silently skips Windows

A regex for absolute paths that starts with `/` never matches `C:\...`, so the check passes on Windows without running.

## Mistake
The lesson citation check pulled absolute paths from a plan with `/\/[^\s]+/`. On Windows the plan names `C:\Users\...\src\a.ts`, nothing matched, and a plan that should have been denied was saved. Linux CI passed; only the Windows test job caught it, after the v0.13.0 tag was pushed, so that release never published.

## Fix
Build path matchers from the real root with `[\\/]` between segments, case-insensitive on Windows, and test them with `path.win32` as well as `path.posix` so Linux runs prove both.
