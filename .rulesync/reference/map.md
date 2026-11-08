---
tags: [map]
---

# Map

Cheap outline. Not a file dump.

## Protocol
- `.rulesync/reference/cascade.md` — session agent tools; job first; spawn scout when the dump needs judgment
- `.rulesync/reference/rtk.md` — shell compression
- `.rulesync/reference/browser.md` — Lightpanda-first session CLI (`nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop`); not MCP
- `.rulesync/reference/hooks.md` — hook policy
- `.rulesync/reference/map.md` — this file
- `.rulesync/reference/output.md` — default voice
- `.rulesync/reference/scope.md` — size gate; plan by default: research → `/write-plan` → approval → `/implement-plan`; two or more slices → `/write-roadmap`
- `.rulesync/reference/law.md` — domain law (stub; protocol stays cascade/overview)
- Generated catalogs: `.rulesync/reference/INDEX.md` — aggregate catalog composed from slices (law.md, skills-map.md, refs-map.md). Maps/law = slices for deep dive. INDEX always. Not if-maps-else

## Agent SSOT
- Docs SoT: `.agents/skills` + `.rulesync/reference`. Generate maps anything placed there. `.claude/skills/<name>` is a generated link to `.agents/skills/<name>`, not SoT; no mirror scan
- `.rulesync/subagents/{orchestrator,repo}.md`
- `.rulesync/rules/overview.md` → `AGENTS.md`
- Default output: `.rulesync/reference/output.md` (overview.md → AGENTS.md; also agent bodies, not auto-injected)

## Skills layout
- Source: `.agents/skills/<name>/SKILL.md`, the one copy (`SKILLS_SOURCE_REL` in `.rulesync/scripts/skill-conflicts.ts`). A consumer's own skills go there too
- Claude Code reads only `.claude/skills`, so `emit-skill-links.ts` (generate, `--check` in check) makes `.claude/skills/<name>` a relative symlink to `../../.agents/skills/<name>` (a junction on Windows). A real dir with a source name is replaced; a real dir with no source name, and links elsewhere, are left alone; a dangling link into `.agents/skills` is pruned. `npm pack` drops symlinks, so each consumer's generate recreates them
- Read directly: Codex and Antigravity read `.agents/skills`; Grok reads `.grok/skills`, `.agents/skills` and `.claude/skills` (deduplicated by name); Cursor reads `.cursor/skills`, `.claude/skills`, `.codex/skills`, `.grok/skills` and `.agents/skills` (follows symlinks, deduplicates by realpath)
- Never run `rulesync generate -f skills`: with no `.rulesync/skills` source, `--delete` wipes `.agents/skills`. The pipeline has no `-f skills` step

## Grok hand files
- `.grok/hooks/orchestrate-parent.ts` + `.grok/hooks/orchestrate-parent.json` — spawn/fat/stop/persist / SubagentStop intercept / session receipt
- Init/upgrade prune: reserved skill dirs this package no longer ships
- `.grok/hooks/rtk.json` — RTK
- `.rulesync/global-settings/` — `manifest.json` (hosts `claude` `codex` `grok` `antigravity` `cursor`: `format`, `payload`, `dest` under `$HOME`) and one payload per host (`claude.json` `codex.toml` `grok.toml` `antigravity.json` `cursor.json`); `sync-global-settings.ts` merges each into its dest (not auto-loaded; project `.grok/config.toml` cannot set `[features]`)
- `.rulesync/mcp-policy.jsonc` — MCP deny-default SSOT (`default: deny`, `allow: []`)
- `.agents/skills/<name>/` — the one skills source; `emit-skill-links.ts` links each into `.claude/skills/<name>`

## Scripts
- `.rulesync/scripts/pipeline.ts` — inner generate/check/watch chain (rulesync + emit-* + hooks-union). Called by `guarded-roots`; not a public package script (`rulesync:generate` `rulesync:check` `rulesync:watch` only)
- `.rulesync/scripts/guarded-md.ts` — sentinel merge for `AGENTS.md`; copied into consumers
- `.rulesync/scripts/guarded-roots.ts` — snapshot/remerge `AGENTS.md` around pipeline; check interiors wrapper
- `.rulesync/scripts/check-globals.ts` — every manifest payload key (minus `skipKeyPattern`) must be present in its `$HOME` dest; project `.grok/config.toml` sets no `[features]` or `[agent]`. Not in the `check` pipeline: `bun run sync:globals:check` and the `bun repo doctor` `globals` row
- `.rulesync/scripts/gate-fat-tools.ts`
- `.rulesync/scripts/scrub-spawn-prompt.ts`
- `.rulesync/scripts/job.ts` — flags `--job` `--query` `--path` `--glob` (repeatable) `--cwd`; regex in `--query` OK; never `cd &&`; unknown flags / exec shell-meta → FALLBACK
- `.rulesync/scripts/parse-need.ts`
- `.rulesync/scripts/persist-handoff.ts` — `.tmp/repo/handoffs/{serial}-{slug}-{stamp}.md`
- `.rulesync/scripts/persist-tmp.ts` — `.tmp/repo/{serial}-{slug}-{stamp}.{ext}` root files
- `.rulesync/scripts/persist-plan.ts`
- `.rulesync/scripts/persist-implementation.ts` — `.tmp/repo/implementations/{serial}-{slug}-{stamp}.md`
- `.rulesync/scripts/sync-global-settings.ts` — dry-run by default, `--apply` writes `$HOME`, `--host <id>`; report line `{action} {id} {dest}`
- `.rulesync/scripts/purge-global-mcps.ts`
- `.rulesync/scripts/emit-mcp-policy.ts`
- `.rulesync/scripts/emit-agent-shell-tools.ts`
- `.rulesync/scripts/browser.ts` — session browser rail
- `.rulesync/scripts/google-workspace.ts` — Sheets Docs Slides Calendar Gmail Drive
- `.rulesync/scripts/speak.ts` — TTS
- `.rulesync/scripts/listen.ts` — STT
- `.rulesync/scripts/setup.ts` — handheld speak / listen / google-workspace / browser (`~/.workerstack/`)
- `.rulesync/scripts/doctor.ts` — unified prereqs; `globals` row (ok or first drift line); optional google-workspace (`oauth` `tokens` `adc` `clasprc`), speak, clasp, ffmpeg, whisper-cli

## Tmp
- `.tmp/repo/plans/` — persist-plan; format SSOT = `.rulesync/reference/plan-format.md`
- `.tmp/repo/implementations/` — persist-implementation; format SSOT = `.rulesync/reference/implementation-format.md`
- `.tmp/repo/orchestrator-logs/` — need-intercept, session-gate, stop-block stamps
- `.tmp/repo/` — scratch + `/tmp` dumps `{serial}-{slug}-{stamp}.{ext}` at root (not nested `tmp/`)
- `.tmp/repo/browser/` — browser session/profile/shot/pdf (not MCP)
- `.tmp/repo/handoffs/` — persist-handoff / `/handoff`
- `.tmp/repo/stash/` — job / snap overflow
- `.tmp/repo/sessions/{sid}/` — wrote/read/receipt
- `.tmp/repo/speak/` — TTS mp3
- `.tmp/repo/listen/` — STT wav + `latest.txt`

## Generated (do not hand-edit; committed, not gitignored)
- `AGENTS.md`
- `.rulesync/reference/INDEX.md`, `skills-map.md`, `refs-map.md` (`emit-maps.ts`)
- `.claude/skills/<name>` links to `.agents/skills/<name>` (`emit-skill-links.ts`)
- `.grok/agents/*`
- `.claude/agents/*`
- `.codex/agents/*`
- `.agents/agents/*`
- `.cursor/hooks.json`, `.cursor/agents/scout.md` (`-t cursor`; hooks-union adds consumer extras to the hooks file; a real dir, not shipped in the package)
- `.grok/config.toml` — project MCP `[[permissions]]` + `[plugins] deny_default`; no `[features]`
- `.mcp.json` — `mcpServers` from policy allow only
- `.claude/settings.json` MCP keys; Agent denies/hooks stay
- `.codex/config.toml` `mcp_servers` (absent when allow empty)
- `.agents/mcp_config.json`
