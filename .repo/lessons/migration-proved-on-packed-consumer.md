---
name: migration-proved-on-packed-consumer
paths: ["cli/sync/migration-*.ts","cli/sync/tmp-repo*.ts","cli/sync/agents-file.ts","cli/sync/agents-stock.ts","cli/sync/region.ts"]
hits: 3
last-hit: 2026-11-14
evidence: ["roadmap 5","roadmap 10","roadmap 12"]
---

# Prove a sync migration on a consumer built from the old packed tgz

## Mistake
Migration rows build the old file by hand. Real old installs differed (user edits around stock text, rules handed over in the same sync, composed rule bodies), so passing rows left a real consumer wrong three times (roadmap 5, plan 115).

## Fix
End Verify with a packed run: `bun pm pack` the old commit and the tree, build a consumer from the old tgz with `repo init --skip-globals` so it leaves host settings alone, edit files as a user would, run `bun add <new tgz>`, and assert the files, the printed lines and a clean `sync --check`.
