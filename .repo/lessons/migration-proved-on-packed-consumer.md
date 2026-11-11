---
name: migration-proved-on-packed-consumer
paths: ["cli/sync/migration-*.ts","cli/sync/agents-file.ts","cli/sync/agents-stock.ts","cli/sync/region.ts"]
hits: 1
last-hit: 2026-11-11
evidence: ["roadmap 5"]
---

# Migrations pass their unit rows and fail a real consumer

A sync migration whose every unit row passed left a real upgraded consumer wrong, three times in one program.

## Mistake
Rows build the old file by hand from what the author thinks an old install wrote. Real old installs differed: a user had edited around the stock text, an old `.repo/rules` file was handed over in the same sync before the region was placed, and the old generator had composed pathless rule bodies into the middle of the stock text. Each case passed its rows and showed up only when a consumer built from the old packed tgz ran `bun add <new tgz>` (roadmap 5 Verify 12.2, then twice in plan 115's rerun).

## Fix
A plan that changes what sync does to a file an older version wrote ends Verify with a packed-consumer run:
- `bun pm pack` the old commit and the tree.
- Build a consumer from the old tgz, then edit the files a user would: lines above and below, an old rules file.
- Run `bun add <new tgz>` and assert the final file line by line, the printed lines, and a clean `sync --check`.

Turn each difference into a failing row before the fix. Rebuild the consumer with `git archive` of a saved commit, not a checkout, so it starts clean.
