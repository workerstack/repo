---
name: tmp
description: Dump a one-off convo artifact under .tmp/repo/.
---
# tmp

One turn. Author from this session (email/script/note). Write once. Recap the absolute path. Stop.

## Invocation

`/tmp [what]`

Empty `$ARGUMENTS` + no already-visible dumpable blob → `need task`. Empty + visible blob (code fence / draft) → dump that.

## When

Dump a one-off convo artifact. Not `/handoff` (no pickup no Goal/State/Next). Not `.tmp/repo/plans/`. Not `.tmp/repo/implementations/`. Not product source. Not OS `/tmp`.

## Path

`.tmp/repo/{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.{ext}`

- serial: unpadded int ≥ 1, next after existing tmp dumps (own counter; not plan/handoff/implementation serials)
- slug: lower, non `[a-z0-9]` → `-`, collapse, trim 50
- stamp: UTC `YYYYMMDDTHHMMSSZ`
- ext: `TMP_EXT` or explicit `.{ext}` in args; else `md`

## Write

```
TMP_NAME: <3-6 word name>
TMP_EXT: md
<artifact only>
```

`TMP_EXT` optional. Write any root filename under `.tmp/repo/` (not `plans|roadmaps|handoffs|implementations|browser|orchestrator-logs|stash|sessions`). Grok `orchestrate-parent.ts` runs `.rulesync/scripts/persist-tmp.ts`: serial/slug/ext from `TMP_*`, strips those lines, no YAML frontmatter, rewrites path + content. Write outside that root or missing `TMP_NAME:` is denied.

Host without that hook: name the file per **Path** yourself, or pipe the body to `bun node_modules/@workerstack/repo/.rulesync/scripts/persist-tmp.ts --workspace {repo}` and use its `absPath`.

Never rewrite an existing dump; new serial. Artifact file content after hook = artifact only (no TMP_* lines no YAML frontmatter).

## Report

```
[tmp]: serial={int} path={abs}/.tmp/repo/{serial}-{slug}-{stamp}.{ext}
```

Do not dump the body.

## Rules

- One write. `/tmp` is not a mode.
- Secrets/tokens: refuse dump. Text artifacts only; no binary.
- Protocol: `node_modules/@workerstack/repo/references/cascade.md`. Do not paste it here.
