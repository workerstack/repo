---
name: migration-proved-on-packed-consumer
paths: ["cli/sync/migration-*.ts","cli/sync/agents-file.ts","cli/sync/agents-stock.ts","cli/sync/region.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 5"]
---

# Prove a sync migration on a consumer built from the old packed tgz

## Mistake
Migration rows build the old file by hand. Real old installs differed (user edits around stock text, rules handed over in the same sync, composed rule bodies), so passing rows left a real consumer wrong three times (roadmap 5, plan 115).

## Fix
End Verify with a packed run: `bun pm pack` the old commit and the tree, build a consumer from the old tgz, edit files as a user would, run `bun add <new tgz>`, and assert the file line by line, the printed lines and a clean `sync --check`. Turn each gap into a row first.
