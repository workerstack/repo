# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.2] - 2026-09-17

### Changed

- TTY init defaults `Apply global prompt optimizations? (recommended)` to Yes (`--skip-globals` still defaults No)

### Fixed

- Init in `$HOME` no longer fails `emit-mcp-policy --check` after globals write `[features]` into the same `~/.grok/config.toml`
- TTY init spinner `stop` keeps the phase name (no empty `◇`)

## [0.6.1] - 2026-09-17

### Changed

- TTY init asks `Apply global prompt optimizations? (recommended)` instead of `Apply globals?`

### Fixed

- Windows tests: host `whichBin` PATHEXT/`F_OK`, cmd shims, and `path.resolve` scratch paths
- Consumer `init` generate: product scripts imported `../cli/` which is not copied. Sentinel helpers live in `scripts/guarded-md.mjs`; setup prompts live in `scripts/prompt.mjs` / `scripts/interactive.mjs`. After init, tests spawn `node ./scripts/guarded-roots.mjs generate` and require every copied script's relative imports to exist on dest

## [0.6.0] - 2026-09-17

### Added

- grunt-job squeez + stash + slice + fetch: keep a better 6, write the rest under `.tmp/grunt/stash/`, retrieve with `--job slice` or Read offset
- Session sidecar `.tmp/grunt/sessions/{sid}/` (wrote/read/receipt); UserPromptSubmit one-line receipt
- Browser `scroll` `wait` `hover` `select`; `snap` stashes fat pages
- Optional `clasp` (doctor + skill + reference)
- `scripts/google-workspace.mjs` (`/google-workspace`): Sheets (create/set/get/append/clear), Docs (create/append), Drive list, Slides, Calendar, Gmail; Desktop OAuth in `~/.grunt/`
- `scripts/speak.mjs` (`/speak`): TTS via ElevenLabs or OpenAI; default mp3 under `.tmp/grunt/speak/`
- `scripts/listen.mjs` (`/listen`): STT via ffmpeg + local whisper.cpp, OpenAI fallback; `rec` prints transcript + `transcript=.tmp/grunt/listen/latest.txt`
- `grunt upgrade`: re-init, prune retired 0.5 names, print reserved skills
- Windows `npm test` CI job
- `/auto` `/ask` session flags: default `sessionGate=auto` keeps going and asks on blockers; `/ask` finishes one step then asks. Stamp `session-gate-{sid}`. Not the 0.5 leftover gate
- `/implement-plan` journal under `.tmp/grunt/implementations/` (touched files, log, blockers); `/commit` uses `## Files` as the default stage set
- Plan test leaves: red-green for new behavior/bugs, test-after for other behavior, skip for docs/rename/config/generated
- `grunt setup` / `scripts/setup.mjs`: handheld speak, listen, google-workspace, and browser setup on any OS (`~/.grunt/`; env still wins). TTY menu shows ok/missing, re-checks PATH after print-only bin hints, asks redo when already ok, prints a four-line status
- Tests for google-workspace verbs against mocked Google APIs
- Doctor reports optional google-workspace (`oauth` / `tokens` / `adc` / `clasprc`; no secrets)
- Init/upgrade prune retired scripts (`telemetry.mjs`), paths (`.grok/parent.md` `.grok/skills/shared`), Grok roles for retired agents, and reserved skill dirs this package no longer ships
- Browser rail swaps Lightpanda → Chromium on blocked/empty/client-rendered snaps and Amazon hosts

### Changed

- Session agent has tools and writes concise complete sentences
- Fat Read/Grep/Bash dumps rewrite to grunt-job first; spawn a grunt model only when the dump needs judgment
- Scratch writes at repo root rewrite into `.tmp/grunt/`
- Full Read of a file this session just wrote is denied; offset slice still works
- Playwright is the app e2e runner; Lightpanda stays the browse default
- Agents: orchestrator + grunt only
- Init prunes retired grunt-owned skills (`parent` `solo` `cascade`) and agents (`implementer` `thinker`)
- `grunt upgrade` no longer warns leftoverGate/spawnMode config keys
- Consumer-facing setup/browser docs: do not read a README unless in-tree doctor/setup/spec is missing; then https://github.com/lovrozagar/grunt#readme (not the consumer README)
- AGENTS.md size gate is a router: straight shot does the work; else `.rulesync/reference/scope.md` (gate + research → suggest → wait → `/write-plan` → `/implement-plan`)
- AGENTS.md order: identity, size + `/auto` `/ask`, INDEX, dumps, browser
- Keep all work free of AI attribution, Co-Authored-By, trailers, and generated markers (not commits only)
- Session prompt: en-US unless asked; skip filler and fluff; rewrite if the solution is not optimal
- AGENTS.md drops the skills inventory; INDEX once, then the matching reference in full
- Browser prompt is the rail plus Chromium fallback, not the verb list

### Fixed

- Windows `npm test`: `.gitattributes` keeps LF so shebang ESM scripts parse (CRLF hashbang is `SyntaxError`)
- `grunt setup` with no extra args (drop dead `flags.args || []`)

### Removed

- implementer and thinker subagents
- leftoverGate / spawnMode flags and leftover `1. 2. 3.` Stop law
- `/solo` `/cascade` `/parent` skills
- `.rulesync/grunt.config.jsonc`, local overlay, example, and `scripts/grunt-config.mjs`. `/auto` is the default; `/ask` is a per-session stamp; `/auto` unlinks it

### Migration

From 0.5.x: `npm i -D @lovrozagar/grunt@latest` then `npm exec grunt upgrade` (or `init`). `.rulesync/grunt.config.jsonc`, the local overlay, and `scripts/grunt-config.mjs` are deleted. leftoverGate/spawnMode are gone. Retired skill/agent dirs, `.grok/roles/{implementer,thinker}.toml`, `.grok/parent.md`, `.grok/skills/shared`, and `scripts/telemetry.mjs` are deleted. New skills/scripts are copied. Consumer extras and npm `grunt:*` scripts stay. Reserved skill names are listed in `.rulesync/reference/law.md`.

## [0.5.2] - 2026-09-02

### Added

- `/ask` and `/auto` session leftover-gate skills (SoT + `.agents` / `.claude` / `.grok` mirrors)
- `.rulesync/grunt.config.jsonc` and `scripts/grunt-config.mjs` for `leftoverGate` / `spawnMode` (fail-closed defaults)
- Orchestrator session stamps for auto-ask and spawn-mode under `.tmp/grunt/orchestrator-logs/`
- `effective=auto` + Implement-typed leftover pick2 chains write-plan persist then implement-plan `{n}` (skip leftover wait)

### Changed

- `/tmp` flatten: write under `.tmp/grunt/{serial}-{slug}-{stamp}.{ext}`; reserved dirs (`plans` `handoffs` `orchestrator-logs` …); `isUnderTmp` is root-only
- Advise leftover: one blank line before numbered pick `1.`
- Browser route: parent spawns grunt with abs `.rulesync/skills/browser/SKILL.md` + `.rulesync/reference/browser.md` (no Skill-invoke / `job:browse`)
- `/solo` and `/cascade` stamp `spawn-mode-{sid}` when slash ≠ config; always unlink grunt-off
- Package `files` include `scripts/grunt-config.mjs`; init/launch scripts (antigravity/claude/codex/gemini/grok) and host agent/skill mirrors synced

## [0.5.1] - 2026-09-01

### Added

- `/tmp` skill (host mirrors) + `scripts/persist-tmp.mjs` (+ tests): one-off convo artifacts under `.tmp/grunt/tmp/`; Grok `orchestrate-parent.js` persist rewrite; Stop tag `[tmp]:`
- Typed advise leftover triple: `{Implement|Write} with verbal|file plan` + `Tweak` — Implement pick1/pick2 still spawn implementer; Write pick1 = `/tmp` persist (no implementer); Write pick2 = write-plan inspect-pause then `/implement-plan {n}` (no implementer this turn); type-mismatch / bare `implement` on Write-typed = no spawn
- Owned-defect after grunt: in-tree/package defect → thinker `Fix {path}` leftover (not fact-stop); workaround stays why-clause

### Changed

- Consumer npm scripts prefixed `grunt:<SoT-key>` (`grunt:rulesync:generate`, `grunt:doctor`, …); init migrates owned unprefixed keys + `npm run` refs; SoT repo scripts stay unprefixed; no aliases — CI/husky must switch
- `package.json` `files` publishes `persist-tmp.mjs`; README documents `/tmp`, typed leftover, and consumer script rename
- Cascade/output/write-plan/implement-plan/orchestrator/thinker (and host mirrors) aligned to typed leftover + `/tmp`

## [0.5.0] - 2026-09-01

### Added

- Advise leftover picks after thinker recap: (1) Implementer with verbal plan (2) Implementer with file plan (3) Tweak — pick1 = implementer + last thinker recap as spec; pick2 = write-plan persist then implement-plan one-shot (`plan=/abs/...`); `/write-plan` ≠ pick2; `/implement-plan {n}` disk/file ≠ verbal
- Thinker recap shape `{decided}. {how-capsule}. {why-clause}`
- rulesync SSOT skills `write-plan` + `implement-plan` (host mirrors under `.agents` / `.claude` / `.grok` as applicable)
- `.rulesync/reference/` maps/index: `INDEX.md` `law.md` `plan-format.md` `refs-map.md` `skills-map.md`
- `scripts/pipeline.mjs` `emit-maps.mjs` `skill-conflicts.mjs` (+ tests/fixtures); doctor `REQUIRED_MAP_FILES` + skill-conflicts warn; `cli/init.mjs` `PRODUCT_SCRIPTS` for those scripts + skill conflict warn

### Changed

- Public `rulesync:generate|check|watch` via guarded-roots → pipeline (drop consumer-facing `:raw` scripts)
- `package.json` `files` publishes `emit-maps` `pipeline` `skill-conflicts`
- README: advise picks; `.rulesync` SoT / host mirrors; maps on generate
- `plan-format` moved to `.rulesync/reference/plan-format.md` (was `.grok/skills/shared/plan-format.md`)
- `commit-and-push` thin alias; explain skill updates as in tree

### Removed

- Tracked `.grok/skills/shared/plan-format.md`
- npm scripts `rulesync:generate:raw` / `rulesync:watch:raw` / `rulesync:check:raw`

## [0.4.2] - 2026-08-31

### Added

- Keep a Changelog history in `CHANGELOG.md` (this file); publish it via `package.json` `files`
- `scripts/guarded-roots.test.ts` for generate/check/watch snapshot-remerge
- README host-support GAP table (Grok/Claude/Codex/Antigravity/Gemini spawn-peek-kill; no invented peek/kill APIs)
- scrub-text tests for remaining mid-intent phrases and blank/ws/fence helpers
- init tests: sentinel auto-skip without a telemetry file; `.grok/hooks/orchestrate-parent.js` means inited, not auto-skip

### Changed

- Parent SoT: `Parent = orchestrator (this file)` in `AGENTS.md` / `CLAUDE.md` / rulesync rules
- `.rulesync/reference/hooks.md` and `map.md`: repo-relative hook/script paths; drop `scripts/telemetry.mjs` from the map
- README package version `0.4.2`; re-init sentinels no longer mention telemetry; Grok-only `write-plan` `implement-plan` `shared` noted as hand files (not rulesync SSOT); published `files` list documents `guarded-roots.mjs` + `CHANGELOG.md` and drops telemetry
- `cli/init.mjs`: drop `telemetry.mjs` from `PRODUCT_SCRIPTS`; `shouldAutoSkipGlobals` no longer treats `scripts/telemetry.mjs` as a sentinel
- `scripts/grunt-job.mjs` and `.grok/hooks/orchestrate-parent.js`: strip `logTelemetry`; `ORCHESTRATOR_LOGS_DIR` inlined on the hook
- Tests drop NDJSON telemetry assertions (`cli/init.test.ts`, `scripts/orchestrate-parent.test.ts`, `scripts/gate-fat-tools.test.ts`)

### Removed

- Product telemetry: `scripts/telemetry.mjs` (append-only `.tmp/orchestrator-logs/telemetry.ndjson` from hooks / grunt-job; fail-open)
- Telemetry as a re-init / globals auto-skip sentinel
- `scripts/telemetry.mjs` from the published `files` list (`scripts/telemetry.test.ts` already absent)

## [0.4.1] - 2026-08-31

### Added

- Init snapshot/remerge of guarded roots `AGENTS.md` `CLAUDE.md` `GEMINI.md` around generate/check/watch
- Orchestrator advise-first Implement picks; `ok` / `yes` / `continue` ≠ implement after conversational advise

## [0.4.0] - 2026-08-31

### Added

- Lightpanda-first session browser rail `nav|snap|click|fill|shot|pdf|stop` plus unified doctor
- Browser skill shipped to host trees
- `/pickup` spawn-first handoff counterpart (not a mode)

## [0.3.11] - 2026-08-28

### Added

- Prompt-is-spec implementer write allowlist (gate)

## [0.3.10] - 2026-08-28

### Added

- `commit-push` release and deploy skills

### Changed

- README rewritten as a full product guide

### Removed

- Architecture Excalidraw diagram

## [0.3.9] - 2026-08-28

### Changed

- Clack CLI prompts

### Fixed

- Orchestrator spawn-first deny Read; clarify `DENY_REASON`

## [0.3.8] - 2026-08-27

### Added

- `/cascade` exit-solo skill

## [0.3.7] - 2026-08-27

### Fixed

- Consumer hook permissions deny without `Write(platform)`

## [0.3.6] - 2026-08-27

### Fixed

- Deny parent Write; voice Stop

## [0.3.5] - 2026-08-27

### Fixed

- Hook `package.json` `"type": "module"` so Stop ESM loads
- Positive-only Stop; thinker offload

## [0.3.4] - 2026-08-27

### Fixed

- Recap tags; stop-block reset

## [0.3.3] - 2026-08-27

### Added

- Stop walls with always-do XOR map

## [0.3.2] - 2026-08-27

### Added

- `--skip-globals` and smarter init merge

## [0.3.1] - 2026-08-27

### Added

- CI publish `@lovrozagar/grunt` to GitHub Packages

### Fixed

- Stop recap, spawn cap, scratch rewrite

## [0.3.0] - 2026-08-27

### Added

- Skills: `handoff`, `solo`, `commit`, `commit-and-push`, `explain`, `parent` (rulesync + host trees)
- Larger init pipeline: `emit-gemini`, `emit-agent-shell-tools`, `emit-mcp-policy`, `hooks-union`, `persist-handoff`
- Gemini CLI agent shells + settings emit
- Orchestrate-parent expansion; host `hooks.json`

### Changed

- Cascade/map/rules sync; package `0.3.0`

## [0.2.0] - 2026-08-27

### Added

- Agents context

### Changed

- Slim agent prompts; max permissions

## [0.1.0] - 2026-08-26

First published tag. No `v0.0.x`.

### Added

- `@lovrozagar/grunt` npm package: deep-merge rulesync trees, product scripts, and generate pipeline into a consumer repo (`npx @lovrozagar/grunt` / `init`)
- Host emit matrix: Grok, Claude Code, Codex, Antigravity; Gemini CLI tracked as a generate gap
- Agents: orchestrator (parent) plus grunt / implementer / thinker
- Product scripts including `grunt-job`, persist-plan, emit-mcp-policy, gate-fat-tools, scrub-spawn-prompt, scrub-text, check-globals, sync-global-settings, purge-global-mcps, and `scripts/telemetry.mjs` NDJSON (present from the first commit)
- Skills: `explain`, `parent`, `terse`; Grok-only `write-plan` / `implement-plan`
- GitHub Actions CI and npm `0.1.0` release

### Fixed

- Terse and spawn rules

[0.4.2]: https://github.com/lovrozagar/grunt/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/lovrozagar/grunt/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/lovrozagar/grunt/compare/v0.3.11...v0.4.0
[0.3.11]: https://github.com/lovrozagar/grunt/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/lovrozagar/grunt/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/lovrozagar/grunt/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/lovrozagar/grunt/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/lovrozagar/grunt/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/lovrozagar/grunt/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/lovrozagar/grunt/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/lovrozagar/grunt/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/lovrozagar/grunt/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/lovrozagar/grunt/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/lovrozagar/grunt/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/lovrozagar/grunt/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lovrozagar/grunt/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lovrozagar/grunt/releases/tag/v0.1.0
