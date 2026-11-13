---
name: windows-paths-from-tools
paths: ["cli/sync-package.ts","cli/link-git.ts","cli/link-io.ts","cli/find-roots.ts","cli/type-surface*.ts","cli/package-locator.ts"]
hits: 3
last-hit: 2026-11-12
evidence: ["plan 67","plan 72","plan 146"]
---

# A path passed to or read from another tool breaks on Windows

## Mistake
On Windows, `tar` on PATH can be Git's GNU tar and reads `C:\x.tgz` as host `C`. Git prints `C:/Users/...`, compared against `C:\...`. Plan 67 passed Linux and macOS and failed only in Windows CI.

## Fix
Do in-process what Bun can (`new Bun.Archive(bytes).extract(dir)`). Return `path.resolve(output.trim())` from every path read from git or a tool. Tests build expected paths with `path.join`. Compare TypeScript's paths through `posix` from `cli/ts-program.ts`.
