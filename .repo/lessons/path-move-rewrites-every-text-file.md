---
name: path-move-rewrites-every-text-file
paths: ["cli/sync/tmp-repo*.ts"]
hits: 1
last-hit: 2026-11-13
evidence: ["roadmap 10"]
---

# A dir move rewrites paths in every moved text file, not bare names

## Mistake
Plan 160's codemod rewrote only `.md` files, so approvals.txt, strategy.json and wrote.txt kept `.tmp/repo` paths. It also mapped a bare `.tmp/repo` with nothing after it to `.repo/scratch`, which garbled prose about the old layout.

## Fix
Rewrite every text file you move, JSON with doubled backslashes included. Rewrite only a path with a segment after the old dir, and leave a bare mention unchanged. Add a test row per file kind and per spelling.
