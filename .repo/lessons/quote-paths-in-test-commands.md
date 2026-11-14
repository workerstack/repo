---
name: quote-paths-in-test-commands
paths: ["cli/**/*.test.ts"]
hits: 1
last-hit: 2026-11-14
evidence: ["plan 213"]
---

# Single-quote every temp path a test puts in a shell command

## Mistake
A test built `git -C ${outside} push` around a temp dir. On posix the path has no backslashes, so Linux passed. On win32 the shell word parser ate the backslashes of the unquoted `C:\Users\...`, the path read as inside the repo, and the Windows CI job failed.

## Fix
Wrap each path a test splices into a command in single quotes (`cd '${dir}' && ...`), since the parser keeps backslashes inside them. A posix run proves nothing about quoting: the win32 job, or a `path.win32` case with a `C:\` path, must run the same line.
