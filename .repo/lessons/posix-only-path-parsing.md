---
name: posix-only-path-parsing
paths: ["cli/scripts/persist-*.ts","cli/scripts/lessons*.ts","cli/scripts/orchestrate*.ts"]
hits: 3
last-hit: 2026-11-04
evidence: ["v0.13.0 test-windows","roadmap 1","v0.16.0 test-windows"]
---

# A path regex that only knows `/` silently skips Windows

## Mistake
The citation check pulled absolute paths with `/\/[^\s]+/`. On Windows `C:\Users\...` never matched, so a plan that should be denied was saved. Only the Windows job caught it, after the v0.13.0 tag, so it never published.

## Fix
Build path matchers from the real root with `[\\/]` between segments, case-insensitive on Windows, and test them with both `path.win32` and `path.posix` so Linux runs prove both.
