---
name: windows-paths-from-tools
paths: ["cli/sync-package.ts","cli/link-git.ts","cli/link-io.ts","cli/find-roots.ts"]
hits: 2
last-hit: 2026-11-10
evidence: ["plan 67","plan 72"]
---

# A path handed to or read from another tool breaks on Windows

On Windows, `tar` on the PATH can be Git's GNU tar, which reads `C:\x.tgz` as host `C` and file `\x.tgz`. Git prints paths with forward slashes (`C:/Users/...`). Code that passes Linux and macOS fails there in CI only.

## Mistake
Plan 67 unpacked `bun pm pack`'s tarball with `tar -xzf <abs path>`, and every link test failed on Windows CI. After that was fixed, the worktree-root cases failed because `git rev-parse --path-format=absolute` returned `C:/...` and the code compared it against `C:\...`.

## Fix
Do in-process what Bun can do: `new Bun.Archive(bytes).extract(dir)` unpacks a `.tgz`, so no `tar` is spawned. At each boundary that reads a path from git or another tool, return `path.resolve(output.trim())`, so callers get native separators and no trailing `\r`. Tests expect native paths, built with `path.join`, never forward-slash literals.
