---
tags: [map]
---

# Map

Cheap outline. Not a file dump.

## Protocol
- `node_modules/@workerstack/repo/references/cascade.md` — session agent tools; job first; spawn scout when the dump needs judgment
- `node_modules/@workerstack/repo/references/rtk.md` — shell compression
- `node_modules/@workerstack/repo/references/browser.md` — Lightpanda-first session CLI (`nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop`); not MCP
- `node_modules/@workerstack/repo/references/hooks.md` — hook policy
- `node_modules/@workerstack/repo/references/map.md` — this file
- `node_modules/@workerstack/repo/references/output.md` — default voice
- `node_modules/@workerstack/repo/references/scope.md` — size gate; plan by default: research → `/write-plan` → approval → `/implement-plan`; two or more slices → `/write-roadmap`
- `node_modules/@workerstack/repo/references/INDEX.md` — the catalog, read first: the repo's domain law, then the generated `repo:skills` (skills), `repo:refs` (reference docs) and `repo:stack` (the stack's packages) sections. INDEX always. Not if-maps-else

## Agent SSOT
- Docs SoT: `.agents/skills` + `references/` (shipped in the package; a consumer reads `node_modules/@workerstack/repo/references/`). `bun repo sync` maps anything placed there. `.claude/skills/<name>` is a generated link to `.agents/skills/<name>`, not SoT; no mirror scan
- The trees come from `cli/sync/agents/` (`sources` `frontmatter` `rules` `subagents` `hooks`) via `bun repo sync`; the `.rulesync/` dir keeps its name
- `.rulesync/subagents/{orchestrator,repo}.md`
- `.rulesync/rules/overview.md` → `AGENTS.md`
- A consumer's own content lives in `.repo/` (below) and `references/`; both are committed, and `bun repo sync` merges them over the package's
- Default output: `node_modules/@workerstack/repo/references/output.md` (overview.md → AGENTS.md; also agent bodies, not auto-injected)

## Skills layout
- Source: `.agents/skills/<name>/SKILL.md`, the one copy (`SKILLS_SOURCE_REL` in `.rulesync/scripts/skill-conflicts.ts`) in this repo. A consumer's own skills go to `.repo/skills/<name>/`, and one named like a stock skill replaces it
- A consumer's `bun repo sync` links each stock skill (and each `.repo/skills/<name>`) into `.agents/skills/<name>` for codex and antigravity and into `.claude/skills/<name>` for claude, as a directory symlink (a junction with an absolute target on Windows): to the generated `.agents/skills/<name>` when there is one, else straight to the skill. Optional packs (`google-workspace` `listen` `speak` `clasp`) are linked only when `agents.skills` names them. In this repo `emit-skill-links.ts` makes `.claude/skills/<name>` a relative symlink to `../../.agents/skills/<name>`. `npm pack` drops symlinks, so each consumer's sync recreates them
- Read directly: Codex and Antigravity read `.agents/skills`; Grok reads `.grok/skills`, `.agents/skills` and `.claude/skills` (deduplicated by name); Cursor reads `.cursor/skills`, `.claude/skills`, `.codex/skills`, `.grok/skills` and `.agents/skills` (follows symlinks, deduplicates by realpath)
- There is no skills generator step: `bun repo sync` only links skills; nothing wipes `.agents/skills`

## Grok hand files
- `.grok/hooks/orchestrate-parent.ts` + `.grok/hooks/orchestrate-parent.json` — spawn/fat/stop/persist / SubagentStop intercept / session receipt
- `bun repo sync` prunes what it wrote last run and no longer plans (the `.repo/tmp/sync.json` manifest); a path outside the manifest is never removed
- `.grok/hooks/rtk.json` — RTK
- `.rulesync/global-settings/` — `manifest.json` (hosts `claude` `codex` `grok` `antigravity` `cursor`: `format`, `payload`, `dest` under `$HOME`) and one payload per host (`claude.json` `codex.toml` `grok.toml` `antigravity.json` `cursor.json`); `sync-global-settings.ts` (`bun repo yolo`) merges each into its dest (not auto-loaded; project `.grok/config.toml` cannot set `[features]`)
- `.rulesync/mcp-policy.jsonc` — MCP deny-default SSOT (`default: deny`, `allow: []`)
- `.agents/skills/<name>/` — the one skills source; `emit-skill-links.ts` links each into `.claude/skills/<name>`

## Scripts
- `.rulesync/scripts/check-globals.ts` — every manifest payload key (minus `skipKeyPattern`) must be present in its `$HOME` dest; project `.grok/config.toml` sets no `[features]` or `[agent]`. Not in `bun repo sync --check`: `bun .rulesync/scripts/check-globals.ts` in this repo and the `bun repo doctor` `globals` row everywhere
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
- `.tmp/repo/plans/` — persist-plan; format SSOT = `node_modules/@workerstack/repo/references/plan-format.md`
- `.tmp/repo/implementations/` — persist-implementation; format SSOT = `node_modules/@workerstack/repo/references/implementation-format.md`
- `.tmp/repo/orchestrator-logs/` — need-intercept, session-gate, stop-block stamps
- `.tmp/repo/` — scratch + `/tmp` dumps `{serial}-{slug}-{stamp}.{ext}` at root (not nested `tmp/`)
- `.tmp/repo/browser/` — browser session/profile/shot/pdf (not MCP)
- `.tmp/repo/handoffs/` — persist-handoff / `/handoff`
- `.tmp/repo/stash/` — job / snap overflow
- `.tmp/repo/sessions/{sid}/` — wrote/read/receipt
- `.tmp/repo/speak/` — TTS mp3
- `.tmp/repo/listen/` — STT wav + `latest.txt`

## `.repo/` layout
Repo-owned content, committed. In this repo `.repo/` holds `lessons/` and the ignored `tmp/`.
- `lessons/` — one file per lesson plus the generated `INDEX.md`
- `rules/` — extra rules, merged into `AGENTS.md` (a hand-written `AGENTS.md` that sync finds is adopted as `agents.md`); a stock rule's extra sections go to `<name>-local.md` so the stock text stays live
- `subagents/` — extra agents; one named like a stock agent replaces it
- `skills/` — extra skills, linked into each host tree (a real skill dir found under `.agents/skills` or `.claude/skills` moves here)
- `settings/claude.json` — keys deep-merged into the generated `.claude/settings.json`
- `mcp.json` — servers deep-merged into the generated `.mcp.json`
- `hooks.jsonc` — replaces the stock hooks whole
- `mcp-policy.jsonc` — deep-merged over the stock MCP policy
- `permissions.json` — path deny rules added to the generated hooks
- `global-settings/` — a payload of the stock's name here (`claude.json`, `codex.toml`, `grok.toml`, `antigravity.json`, `cursor.json`) replaces that stock payload whole in `bun repo yolo` and the `globals` check; the stock manifest stays
- `tmp/` — ignored: `sync.json` (the manifest) and `stage/` (the build dir, removed after each sync)

## Generated (do not hand-edit)
`bun repo sync` writes these from `node_modules/@workerstack/repo` plus `.repo/` for the hosts in `agents.hosts` (default: all five; `HOST_TREES` in `cli/sync/hosts.ts` is the one table). In a consumer they are gitignored and recreated by every `bun install`; in this repo they are committed. `bun repo sync --check` reports drift.
- `AGENTS.md` — any host on
- `.mcp.json` — `mcpServers` from policy allow only; claude
- claude → `.claude/`: `agents/*`, `settings.json` (MCP keys, hooks, the `.repo/settings/claude.json` merge), `skills/<name>` links
- codex → `.codex/` (`agents/*`, `config.toml` `mcp_servers`, absent when allow empty) and `.agents/skills/<name>` links
- antigravity → `.agents/`: `agents/*`, `skills/<name>` links, `mcp_config.json`, hooks
- grok → `.grok/`: `agents/*`, `config.toml` (project MCP `[[permissions]]` + `[plugins] deny_default`; no `[features]`), `roles/scout.toml`, `hooks/rulesync.json`; the `.grok/hooks/*.ts` stay in the package
- cursor → `.cursor/`: `hooks.json` (hooks-union adds consumer extras), `agents/scout.md`; a real dir, not shipped in the package
- always: `bunfig.toml`, the managed `.gitignore` block, `references/INDEX.md` sections `repo:skills`, `repo:refs`, `repo:packages` and `repo:stack`, `.repo/lessons/INDEX.md` when lessons exist, `.vscode/tasks.json` (committed in a consumer too)

## Generator divergences
Where `cli/sync/agents/` differs from the rulesync 43.7.0 it replaced:
- YAML 1.2 parsing: `yes` stays a string
- No 80-column folding of long values
- The `agentsmd` and `codexcli` rule targets both fold into `AGENTS.md` only
- A leading `./` in a claude hook command becomes `"$CLAUDE_PROJECT_DIR"/`
- A bad subagent, or a rule without frontmatter, fails sync
