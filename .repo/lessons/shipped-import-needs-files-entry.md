---
name: shipped-import-needs-files-entry
paths: ["package.json","presets/**"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# A new import into shipped code needs its package.json files entry

The tarball shipped a module that imported a file the tarball did not contain.

## Mistake
Plan 139 added a runtime import to a file the presets reach. `package.json` `files` lists the shipped dist files one by one, so the new target was left out of the pack. Every local check passed, because the checkout has every file. Only a packed consumer showed the missing module.

## Fix
When a file that ships (presets, the `exports` subpaths, or anything they import) gains a runtime import, add the target to `package.json` `files`. Then run `bun repo release consumer`, which installs the real tarball.
