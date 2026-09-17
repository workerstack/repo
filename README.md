# Grunt

Multi-agent orchestrator SoT — deep-merge rulesync trees product scripts and generate pipeline into a consumer repo

OSS drop-in; merges existing configs; switches default provider flow to Grunt.

- [Install](#install)
- [Prerequisites](#prerequisites)
- [Usage](#usage)
- [CLI](#cli)
- [Init](#init)
- [Version bump](#version-bump)
- [Agents](#agents)
- [Skills](#skills)
- [Generate](#generate)
- [Config](#config)
- [Architecture](#architecture)
- [Layout](#layout)
- [Develop](#develop)
- [Examples](#examples)
- [License](#license)

## Install

- Node.js 22+
- Consumer:

```
npm i -D @lovrozagar/grunt
npm exec grunt
```

- Same as `npm exec grunt init` when no command
- Do not `npm test` as a consumer
- Package: `@lovrozagar/grunt` `0.6.0` MIT · https://github.com/lovrozagar/grunt

## Prerequisites

All OS. Print-only. Never auto-install.

```
npm exec grunt doctor
node scripts/doctor.mjs
```

Exit 1 if any required missing; 0 if all required ok. Optional tools are reported; missing optional does not fail.

| tool | required | install |
| --- | --- | --- |
| node ≥22 + npm | yes | https://nodejs.org (≥22) · nvm / OS pkg · win `winget install OpenJS.NodeJS.LTS` |
| git | yes | linux `sudo apt install git` · mac `brew install git` · win `winget install Git.Git` |
| rtk | yes | linux/mac `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh \| sh` or `brew install rtk` · win release zip `rtk.exe` on PATH or WSL curl ([docs](https://www.rtk-ai.app/docs/getting-started/installation/)) |
| rulesync | yes | `npm i -D rulesync` / npx (PATH or npx-able) |
| lightpanda | yes | `curl -fsSL https://pkg.lightpanda.io/install.sh \| bash` · mac `brew tap lightpanda-io/browser` · win WSL only |
| chromium-family | yes | linux `sudo apt install chromium` · mac `brew install --cask chromium` or `google-chrome` · win `winget install Google.Chrome` / `Microsoft.Edge` + PATH |
| gh | no | report only |
| clasp | no | `npm i -g @google/clasp` · custom Apps Script only |
| google-workspace | no | `node scripts/google-workspace.mjs` · Sheets Docs Slides Calendar Gmail · doctor reports `oauth`/`tokens`/`adc`/`clasprc` (no secrets) · `grunt setup` / `node scripts/setup.mjs google-workspace` |
| speak | no | `node scripts/speak.mjs` · TTS output (ElevenLabs or OpenAI) · `grunt setup` / `node scripts/setup.mjs speak` · or `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` / `~/.grunt/speak.json` |
| ffmpeg | no | mic capture for `/listen` · mac `brew install ffmpeg` · linux `sudo apt install ffmpeg` · win `winget install Gyan.FFmpeg` |
| whisper-cli | no | local STT for `/listen` · mac `brew install whisper-cpp` · first listen downloads `ggml-base.en.bin` · setup in `.rulesync/reference/listen.md` |
| listen | no | `node scripts/listen.mjs` · STT input · `grunt setup` / `node scripts/setup.mjs listen` · local whisper.cpp then OpenAI Whisper |

Rulesync schema doctor is separate: `npm run grunt:rulesync:doctor`.

## Usage

- TTY no command → menu (init default; generate check sync-globals purge-mcps doctor setup upgrade help quit)
- Piped / CI / `--yes` / `-y` / `--non-interactive` no command → still `init`
- Bin: `grunt` → `./bin/grunt.js` (`type: module`)

## CLI

### Commands

- `init` → `init()` — merge SoT, `npm install`, `grunt:rulesync:generate`, `grunt:sync:globals:apply`, `grunt:rulesync:check`
- `generate` → `npm run grunt:rulesync:generate`
- `check` → `npm run grunt:rulesync:check`
- `sync-globals` → `npm run grunt:sync:globals` (dry-run); `--apply` → `grunt:sync:globals:apply`
- `purge-mcps` → `npm run grunt:purge:global-mcps` (dry-run); `--apply` → `grunt:purge:global-mcps:apply`
- `doctor` → `npm run grunt:doctor` (`npm exec grunt doctor` / `node scripts/doctor.mjs` stay). Rulesync schema: `npm run grunt:rulesync:doctor`
- `setup` → `npm run grunt:setup` (`node scripts/setup.mjs`) — handheld speak / listen / google-workspace / browser. TTY walks each; flags for non-TTY keys/`--creds`
- `upgrade` → same merge as init for an already-inited repo: copy owned trees/scripts, prune retired grunt-owned names, print reserved skill names
- `help`
- `version`

### Flags

- `--skip-globals` — skip `sync:globals:apply` on init
- `--yes` / `-y` / `--non-interactive` — no TTY menu; default command still `init`. Not `--apply`
- `--apply` — write for `sync-globals` / `purge-mcps`
- `--host <id>` — `sync-globals --host <id>`

## Init

- Merge SoT `npm install` `grunt:rulesync:generate` `grunt:sync:globals:apply` `grunt:rulesync:check`
- `--skip-globals` skips apply
- TTY init asks `Apply global prompt optimizations? (recommended)` (default Yes; `--skip-globals` defaults No)
- Non-interactive re-init auto-skips globals when `<!-- grunt:begin -->` in `AGENTS.md`/`CLAUDE.md`
- First init (no sentinel) applies globals unless flagged
- Owned trees/scripts refresh; extra `.rulesync` files kept; patches to grunt-owned files lost
- `cp` cannot delete dest extras. Init/upgrade then prune: retired skills `parent` `solo` `cascade`, agents `implementer` `thinker` (plus `.grok/roles/{implementer,thinker}.toml` and `.gemini/agents/{name}/`), scripts `telemetry.mjs` `grunt-config.mjs`, paths `.grok/parent.md` `.grok/skills/shared` `.rulesync/grunt.config.jsonc` plus local overlay and example, and reserved skill dirs this package no longer ships. Consumer extras stay.
- Breaking: consumer npm scripts are `grunt:<SoT-key>` (`grunt:rulesync:generate`, `grunt:doctor`). Re-init migrates `package.json` (owned unprefixed keys + suffixes; `npm run` refs in other dest scripts). CI/husky/`npm run rulesync:*` / `npm run doctor` must switch. No aliases. SoT repo scripts stay unprefixed (`npm run rulesync:generate`).

## Version bump

Already-inited consumer (0.5.x → 0.6, and later):

```
npm i -D @lovrozagar/grunt@latest
npm exec grunt upgrade
```

`upgrade` is init plus a reserved-names print. Same merge, prune, and globals-skip rules as Init. New skills/scripts appear because they are in the package copy list. Dropped grunt-owned files disappear only if they are on the retired lists (or a reserved skill this package no longer ships). Do not expect a blind dest-dir mirror-delete; that would wipe consumer extras.

## Agents

SoT: `.rulesync/subagents/{orchestrator grunt}.md`

Emit: `.claude/` `.grok/` `.agents/` `.gemini/`

- **orchestrator** — session agent. Tools on. Does the work. en-US unless asked. Concise complete sentences with natural grammar. Skip filler and fluff. Optimal solutions only; rewrite if not. Flag blockers. Do not monkey-patch. Runs `node scripts/grunt-job.mjs` for fat dumps; spawn grunt only when the dump needs judgment.
- **grunt** — isolation worker. Facts only (≤8 lines, stash receipt when needed).

Fat dumps rewrite to `scripts/grunt-job.mjs` (squeez + stash). Scratch goes in `.tmp/grunt/`. Voice: `.rulesync/reference/output.md`. `GEMINI.md` → `@AGENTS.md`.

## Browser

Lightpanda-first session CLI: `node scripts/browser.mjs`. Zero MCP. Zero env knobs. The rail swaps to Chromium for `shot`/`pdf`/`trace`, Windows, missing Lightpanda, probe-fail, Chromium-first hosts (figma, Google docs/sheets/slides, Gmail, earth, Amazon), or a blocked/empty/client-rendered snap. Session: `.tmp/grunt/browser/`. Spec: [`.rulesync/reference/browser.md`](.rulesync/reference/browser.md). App e2e uses Playwright. URL-in-a-cite is a cite.

`node scripts/browser.mjs doctor` (alias `ensure`) runs the unified doctor (`scripts/doctor.mjs`). Install engines: [Prerequisites](#prerequisites).

## Skills

Present under `.claude` / `.rulesync` / `.agents` / `.grok` (`rulesync -f skills` mirrors SSOT):

- `ask` `auto` `browser` `clasp` `commit` `commit-and-push` (1-release alias → `commit-push`) `commit-push` `commit-push-deploy` `commit-push-release` `explain` `google-workspace` `handoff` `implement-plan` `listen` `pickup` `speak` `tmp` `write-plan`

`/auto` (default) keeps going and asks on blockers. `/ask` finishes one step, recaps, then asks. `/auto` returns the session to auto.

Reserved names: do not reuse those stems for consumer custom skills. Same name → one SSOT under `.rulesync/skills/<name>/`; re-init force-refresh overwrites grunt-owned names; extras kept; maps `origin` badge ≠ content picker. Retired 0.5 names (`parent` `solo` `cascade` plus subagents `implementer` `thinker`) are pruned on init/upgrade. See `.rulesync/reference/law.md` (flows into INDEX).

Size first: `.rulesync/reference/scope.md`. Straight shot → do it. Else that file.

`/write-plan` and `/implement-plan` SSOT: `.rulesync/skills/{write-plan,implement-plan}/`; format SSOT `.rulesync/reference/plan-format.md`. `/write-plan` plan-only inspect-pause → `next: /implement-plan {n}`; empty `/implement-plan` resumes unique in-progress or starts unique ready, else lists (need serial); slash `/implement-plan {n}` disk/file. The session agent executes the plan. `/implement-plan` also writes `.tmp/grunt/implementations/` (format `.rulesync/reference/implementation-format.md`): Files / Log / Done for commits. Straight shots skip the journal.

## Generate

SoT: `.rulesync/skills` + `.rulesync/reference`. Generate maps anything placed there. `.agents` / `.claude` (and other host trees) are mirrors, not SoT; no mirror scan.

Pipeline (no `-t geminicli`):

1. `rulesync generate` — emit grok / claude / codex / antigravity
2. `emit-mcp-policy.mjs`
3. `emit-gemini.mjs` — `GEMINI.md` `.gemini/agents/{id}/agent.md` MCP `.gemini/settings.json`
4. `emit-agent-shell-tools` — Claude grunt body `Bash`; other hosts `run_terminal_command` (hooks-union)

`check` = rulesync check. `doctor` = unified prereqs. Schema: `npm run rulesync:doctor`.

Emit writes other-CLI trees from `.rulesync` for the **next** process of that CLI. Not a live hop into another host.

## Config

- SoT merge into consumer repo; existing configs kept where not grunt-owned
- Globals: first init apply; re-init auto-skip (sentinel) or `--skip-globals`
- `sync-globals` / `purge-mcps`: dry-run default; `--apply` writes
- Hosts: grok claude codex gemini antigravity

### Secrets (machine)

Not git. Not `sync-globals`.

First-hand: `npm exec grunt setup` (TTY). Per target: `node scripts/setup.mjs speak|listen|google-workspace|browser`. Spec: `.rulesync/reference/setup.md`.

| | where |
| --- | --- |
| Speak / listen OpenAI | `OPENAI_API_KEY` or `~/.grunt/speak.json` `openai.apiKey` |
| Speak ElevenLabs | `ELEVENLABS_API_KEY` or `~/.grunt/speak.json` `elevenlabs.apiKey` |
| Listen extras | `WHISPER_MODEL` `LISTEN_DEVICE` `LISTEN_STT` `SPEAK_PROVIDER` — optional |
| Google Workspace | OAuth under `~/.grunt/` |

`~/.grunt/speak.json` chmod 600. Env wins over that file. Copy the file or export env on another machine. Doctor reports optional google-workspace / speak / ffmpeg / whisper-cli.

`sync-globals` is host CLI globals (MCP and friends), not API keys.

## Architecture

Protocol picture: one CLI host process, session orchestrator in that session with tools on, optional grunt isolation sibling, local workspace tools with RTK on Bash stdout only, one vendor Model API outside the host bubble. Not a product walkthrough. `@lovrozagar/grunt` = protocol SoT + CLI (init/generate/check); not a model runtime. Do not paste `.rulesync/reference/cascade.md` here — boxes and edges only.

### Containment

Draw **one** CLI host bubble. That bubble is **this** session’s CLI: Grok Build, Claude Code, Codex, Gemini CLI, or Antigravity. The CLI **is** the host — not a peer router beside another CLI. Parent lives **inside** that host session. Children spawn **inside the same process**. Other CLIs = emit/config on disk only; no runtime hop; no shared spawn/peek line.

User-visible conversation attaches only to the session agent. Children never talk to the user. Children never spawn. The session agent does the work. Spawn grunt only when isolation is cheaper.

### Host support (GAP)

Not feature-parity across hosts. In-tree mapping only; do not invent peek/kill APIs. GAP rows: no fake peeks, no auto-kill; block on spawn return and classify `done`.

| Host | Spawn | Peek | Kill |
| --- | --- | --- | --- |
| Grok | `spawn_subagent` `background:true` → `task_id` | `get_command_or_subagent_output` + `timeout_ms=60000` | `kill_command_or_subagent` (user-ask only) |
| Claude Code | `Agent` if the parent session exposes it | GAP unless an in-tree schema names a status/output tool on that id (do not invent `TaskOutput`); else block on Agent return and classify `done`. Agent launch ≠ child done; in-flight host Stop → only `[orchestrator]: wait grunt`; no SendMessage | GAP unless in-tree; no auto-kill |
| Codex | host agent/call | GAP; block on host agent/call return; classify `done` | GAP; no auto-kill |
| Antigravity | main-session parent | GAP peek/kill; main-session parent | GAP; no auto-kill |
| Gemini | not emitted; tracked gap | GAP; no fake peeks | GAP; no auto-kill |

### Nested diagram

Same topology as the session recap; every legal edge labeled.

```
 USER
  │
  │  session in/out  (session agent only; tagged recap)
  │  TUI local; completion tokens from Model API (mixed)
  ▼
┌──────────────────────── CLI HOST (this process) ────────────────────────┐
│  TUI · hooks · emit/generate · RTK PreToolUse · fs workspace            │
│                                                                         │
│  Session orchestrator  (tools on; grunt-job first)                      │
│    legal spawn type: grunt                                              │
│    omit model on spawn; FM on agent files picks haiku/sonnet/opus       │
│    vs grok-4.5 / grok-4.6 / etc.                                        │
│                                                                         │
│         spawn / peek (optional)                                         │
│                    │                                                    │
│                    ▼                                                    │
│         grunt sibling (never spawn; facts ≤8 lines)                     │
│                    │                                                    │
│                    └──────── tool call ──────────┐                      │
│                        │                                                │
│                        ▼                                                │
│          host tools (same process)                                      │
│            fs: Read / Grep / Glob / Write                               │
│            Bash / run_terminal_command                                  │
│                 │                                                       │
│                 └──RTK (PreToolUse; Bash/shell stdout only)──► compress │
│                                                                         │
│          local (not Model API):                                         │
│            spawn_subagent / Agent · peek                                │
│            workspace tools · RTK                                        │
│            scrub-spawn-prompt · parse-need · grunt-job                  │
│            emit / generate                                              │
│                                                                         │
│          WebSearch / web_fetch = remote-not-LLM (not a second model)    │
│          MCP = denied in-tree; do not draw as a main path               │
│                                                                         │
│          parent + children  ──completion─────────────────────────────┐  │
└──────────────────────────────────────────────────────────────────────┼──┘
                                                                       │
                                                                       ▼
                                                         Model API
                                                         (this host’s SDK
                                                         only; one box)
                                                                       ..
                                                         emit/config
                                                         (no runtime line)
                                                                       ..
                                                         other CLIs
                                                         Gemini spawn/peek
                                                         = GAP
                                                         (no fake peeks)
```

### `need:` / grunt-job

The session agent runs `node scripts/grunt-job.mjs --job search|exec|slice|fetch|test` for fat dumps. A grunt child that still needs a fat dump **stops** on a `need:` JSON line. SubagentStop intercepts `search|exec|slice|fetch` (cap 4) in-hook. Spawn a grunt **model** only when the dump needs judgment. Grunt does not emit `need:` for its own tool use.

```
 session agent
      │
      │  grunt-job first
      ▼
 node scripts/grunt-job.mjs --job search|exec|slice|fetch|test
      │
      │  spawn grunt model only if the dump needs judgment
      ▼
 grunt isolation facts (≤8 lines, optional stash=)
```

### Node table

| node | inside host? | local vs AI-server | notes |
| --- | --- | --- | --- |
| User | no | mixed | Speaks only to the session agent. Never a child edge. |
| Session in/out / TUI | yes | mixed | TUI is local; recap tokens come from the model. Legal `[role]:` tagged recap. |
| CLI host process | yes (is the box) | local process | Grok Build / Claude Code / Codex / Gemini / Antigravity. Not a peer of another CLI. |
| Session orchestrator | yes | AI-server **turn** | Does the work. Tools on. grunt-job first. Lives in this session, not a sidecar. |
| `grunt` sibling | yes | AI-server **turn** | Facts/tools/mechanical write. Never spawn. Never feature solution. Optional. |
| Host spawn / peek | yes | **local** | `spawn_subagent` / `Agent` and host peek tools. Gemini spawn/peek = GAP; block on return, classify `done`; no fake peeks. Other hosts: spawn is an optimization; grunt-job still runs in-process. |
| Workspace fs tools | yes | **local** | Read/Grep/Glob/Write (and host aliases). Fat dumps still gate. |
| Bash / `run_terminal_command` | yes | **local** | RTK wraps stdout on PreToolUse. |
| RTK | yes | **local** | Bash/shell stdout compression only. Not Read/Grep/Glob/prompts/images. |
| `scrub-spawn-prompt` / `parse-need` / `grunt-job` | yes | **local** | Hooks and scripts. Isolation facts are grunt-job output, not a model hop. |
| emit / generate / init | yes (this repo / install) | **local** | Writes other-CLI configs. Not a runtime line to those CLIs. |
| WebSearch / web_fetch | tool from host | **remote-not-LLM** | Network search/fetch. Not a second Model API box. Snippet/cite/"what is X"/world fact: grunt `job: web`. Live URL/DOM: grunt browser rail, not this box. |
| MCP | policy deny | n/a | Denied by policy in-tree. Do not draw as a main path. |
| Model API | **no** (one box outside) | AI-server | This host’s vendor SDK only. Parent and child **turns** complete here. Spawn omits model; frontmatter on `.rulesync/subagents/*.md` picks the model. |
| Other CLIs | no (not this process) | emit/config only | Same protocol files emitted elsewhere. No hop, no shared peek. |
| `@lovrozagar/grunt` | package / CLI | local install | Protocol SoT + CLI. Not a model runtime. |

### Edge labels

Use these labels. Do not revive “prompt input” or “agent to use”.

| edge | meaning |
| --- | --- |
| **session in/out** | User ↔ session agent only. Children have no user edge. |
| **spawn** | Session agent → `grunt`. First sentence: `You are grunt subagent.` Omit model. Optional. |
| **peek** | Session agent reads host status on the child id. Real host fields. `timeout_ms=60000`. GAP hosts: no fake peeks; block on spawn return = `done`. |
| **need:** | Child stop line: fat dump jobs interceptable as grunt-job. Cap 4 jobs per batch. |
| **facts** | Grunt isolation result back onto `resume_from`. Sentence plus dash facts, not dumps. |
| **tool call** | Child (or, illegally if parent, denied) → host tools. |
| **RTK** | PreToolUse Bash/shell → compressed stdout. No other tools. |
| **completion** | Parent and children → **one** Model API (this host’s SDK). |
| **emit/config** | Disk write to other CLI trees. Drawn with a broken line or footnote, **not** a session arrow. |

### What not to draw

- A **CLI Provider** box as a peer of the host, or a router that hops between CLIs at runtime
- **implementer** or **thinker** siblings — gone in 0.6
- **Per-agent Model API** boxes — one Model API outside the host, this SDK only
- **Child → child spawn** — isolation is grunt-job or a grunt sibling
- **MCP** as a happy-path tool rail
- **RTK** on Read/Grep/Glob/prompts/images
- **User** arrows into grunt
- Gemini **fake peek** loops. GAP: no invented status API; block on return

### Emit footnote and Gemini GAP

**Emit.** `rulesync generate` plus in-tree emit scripts write Claude/Codex/Antigravity/Gemini/Grok trees from `.rulesync`. Config on disk for the **next** process of that CLI. Not a live message into another host. Multi-CLI in a diagram = footnote or a second, disconnected host bubble — never an arrow from this session.

**Gemini GAP.** Gemini is not emitted as a spawn/peek host in the cascade table. Do not invent peek or kill APIs. If a Gemini session is the host, treat spawn/peek as GAP: no fake peeks, no auto-kill; block on the host call returning and classify `done`. Other GAP rows (cascade host mapping): Claude Code unless an in-tree schema names a status/output tool; Codex peek/kill; Antigravity peek/kill.

### Protocol pointers

Repo-relative (repository root):

- `.rulesync/reference/INDEX.md` — aggregate catalog composed from slices (law.md, skills-map.md, refs-map.md). Maps/law = slices for deep dive. Always. Not if-maps-else
- `.rulesync/reference/law.md` — domain law stub (protocol stays cascade/overview)
- `.rulesync/reference/cascade.md` — parent-only spawn, peek/kill table, `need:` / `resume_from`, isolation facts
- `.rulesync/reference/rtk.md` — Bash/shell stdout compression
- `.rulesync/reference/map.md` — cheap outline of protocol, scripts, generated trees
- `.rulesync/subagents/orchestrator.md`
- `.rulesync/subagents/grunt.md`

## Layout

Published (`package.json` `files`): `bin/grunt.js` `cli` `scripts/check-globals.mjs` `scripts/emit-agent-shell-tools.mjs` `scripts/emit-gemini.mjs` `scripts/emit-maps.mjs` `scripts/guarded-md.mjs` `scripts/guarded-roots.mjs` `scripts/emit-mcp-policy.mjs` `scripts/gate-fat-tools.mjs` `scripts/hooks-union.mjs` `scripts/pipeline.mjs` `scripts/grunt-job.mjs` `scripts/parse-need.mjs` `scripts/persist-handoff.mjs` `scripts/persist-implementation.mjs` `scripts/persist-tmp.mjs` `scripts/persist-plan.mjs` `scripts/purge-global-mcps.mjs` `scripts/scrub-spawn-prompt.mjs` `scripts/scrub-text-lib.mjs` `scripts/sync-global-settings.mjs` `scripts/browser.mjs` `scripts/speak.mjs` `scripts/listen.mjs` `scripts/google-workspace.mjs` `scripts/interactive.mjs` `scripts/prompt.mjs` `scripts/setup.mjs` `scripts/doctor.mjs` `scripts/skill-conflicts.mjs` `scripts/scrub-text` `.rulesync` `.grok` `.codex` `.claude` `.agents` `AGENTS.md` `CLAUDE.md` `.mcp.json` `README.md` `LICENSE` `CHANGELOG.md`

No `scripts/*.test.ts` `scripts/fixtures/` `docs/` `coverage/` `vitest.config.ts` in `files`. `cli` dir ships whole (includes `cli/*.test.ts`).

Not packed: `GEMINI.md` `.gemini/` — `emit-gemini.mjs` writes them on `generate` / `init` (`GEMINI.md` → `@AGENTS.md`). Not in `files`.

Repo root (also): `coverage/` `.gemini/` `GEMINI.md` — no `src/` no `CONTRIBUTING` no `docs/`

- `bin/grunt.js` — CLI bin
- `cli/grunt.mjs` — commands
- `scripts/` — init copies product scripts (`grunt-job.mjs` `scrub-text` …). Re-init sentinels: `.grok/hooks/orchestrate-parent.js` `.rulesync` `<!-- grunt:begin -->`
- `.rulesync/` — SoT (subagents skills reference). Skills + reference maps on generate; host trees are mirrors
- `.claude/` `.grok/` `.codex/` `.agents/` `.gemini/` — host emit; not SoT; no mirror scan
- `coverage/` — vitest local not published

## Develop

Contributors to this repo only:

```
npm i && npm test
```

- Test: `vitest run --coverage`
- Test include: `scripts/**/*.test.ts` `cli/**/*.test.ts`
- Coverage include: `cli/**`
- Coverage thresholds: 100% lines / functions / branches / statements
- Dev deps include rulesync vitest typescript

## Examples

Keep these four flows only:

1. “Create me a react weather app” → session agent writes (or `/write-plan` then `/implement-plan {n}`) → recap
2. “What is 2+2” → session agent → recap
3. Marvel theatrical next → session agent web search → recap
4. `.logs` 3/6/2021 tag `framework bug` → `grunt-job --job search` → recap

## License

MIT © 2026 lovrozagar
