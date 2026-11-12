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
- `node_modules/@workerstack/repo/references/INDEX.md` — the catalog, read first: the repo's domain law, then the generated `repo:skills` (skills), `repo:refs` (reference docs), `repo:stack` (the stack's installed packages) and `repo:available` (the published ones not installed) sections. INDEX always. Not if-maps-else

## Agent SSOT
- Docs SoT: `agents/skills` + `references/` (shipped in the package; a consumer reads `node_modules/@workerstack/repo/references/`). `bun repo sync` maps anything placed there. `.claude/skills/<name>` and `.agents/skills/<name>` are generated links to `agents/skills/<name>`, not SoT; no mirror scan
- The trees come from `cli/sync/agents/` (`sources` `frontmatter` `rules` `subagents` `hooks`) via `bun repo sync`, reading the stock sources in `agents/` (exported as `@workerstack/repo/agents/*`)
- `agents/subagents/{orchestrator,repo}.md`
- `agents/rules/overview.md` → `AGENTS.md`
- A consumer's own content lives in `.repo/` (below) and `references/`; both are committed, and `bun repo sync` merges them over the package's
- Default output: `node_modules/@workerstack/repo/references/output.md` (overview.md → AGENTS.md; also agent bodies, not auto-injected)

## Skills layout
- Source: `agents/skills/<name>/SKILL.md`, the one copy (`STOCK_SKILLS_REL` in `cli/scripts/skill-conflicts.ts`) in this repo. A consumer's own skills go to `.repo/skills/<name>/`, and one named like a stock skill replaces it
- A consumer's `bun repo sync` links each stock skill (and each `.repo/skills/<name>`) into `.agents/skills/<name>` for codex and antigravity and into `.claude/skills/<name>` for claude, as a directory symlink (a junction with an absolute target on Windows): to the generated `.agents/skills/<name>` when there is one, else straight to the skill. Optional packs (`google-workspace` `listen` `speak` `clasp`) are linked only when `agents.skills` names them, and a config pack can gate a stock skill the same way (the `benchmark` pack links `/benchmark`). In this repo sync links both `.claude/skills/<name>` and `.agents/skills/<name>` straight to `agents/skills/<name>` with a relative link. The package ships no generated trees, so each consumer's sync makes its links
- Read directly: Codex and Antigravity read `.agents/skills`; Grok reads `.grok/skills`, `.agents/skills` and `.claude/skills` (deduplicated by name); Cursor reads `.cursor/skills`, `.claude/skills`, `.codex/skills`, `.grok/skills` and `.agents/skills` (follows symlinks, deduplicates by realpath)
- There is no skills generator step: `bun repo sync` only links skills; nothing wipes `.agents/skills`

## Grok hand files
- `cli/scripts/orchestrate-parent.ts` + `agents/grok/hooks/orchestrate-parent.json` — spawn/fat/stop/persist / SubagentStop intercept / session receipt
- `bun repo sync` prunes what it wrote last run and no longer plans (the `.repo/tmp/sync.json` manifest); a path outside the manifest is never removed
- `agents/grok/hooks/rtk.json` — RTK
- `agents/global-settings/` — `manifest.json` (hosts `claude` `codex` `grok` `antigravity` `cursor`: `format`, `payload`, `dest` under `$HOME`) and one payload per host (`claude.json` `codex.toml` `grok.toml` `antigravity.json` `cursor.json`); `sync-global-settings.ts` (`bun repo yolo`) merges each into its dest (not auto-loaded; project `.grok/config.toml` cannot set `[features]`)
- `agents/mcp-policy.jsonc` — MCP deny-default SSOT (`default: deny`, `allow: []`)
- `agents/grok/{roles,hooks}/` — grok's static roles and hook configs; `bun repo sync` copies them into `.grok/roles` and `.grok/hooks`
- `agents/skills/<name>/` — the one skills source; `bun repo sync` links each into the host skill dirs

## Scripts
- `cli/scripts/check-globals.ts` — every manifest payload key (minus `skipKeyPattern`) must be present in its `$HOME` dest; project `.grok/config.toml` sets no `[features]` or `[agent]`. Not in `bun repo sync --check`: `bun cli/scripts/check-globals.ts` in this repo and the `bun repo doctor` `globals` row everywhere
- `cli/scripts/gate-fat-tools.ts`
- `cli/scripts/scrub-spawn-prompt.ts`
- `cli/scripts/job.ts` — flags `--job` `--query` `--path` `--glob` (repeatable) `--cwd`; regex in `--query` OK; never `cd &&`; unknown flags / exec shell-meta → FALLBACK
- `cli/scripts/parse-need.ts`
- `cli/scripts/persist-handoff.ts` — `.tmp/repo/handoffs/{serial}-{slug}-{stamp}.md`
- `cli/scripts/persist-tmp.ts` — `.tmp/repo/{serial}-{slug}-{stamp}.{ext}` root files
- `cli/scripts/persist-plan.ts`
- `cli/scripts/persist-implementation.ts` — `.tmp/repo/implementations/{serial}-{slug}-{stamp}.md`
- `cli/scripts/sync-global-settings.ts` — dry-run by default, `--apply` writes `$HOME`, `--host <id>`; report line `{action} {id} {dest}`
- `cli/scripts/purge-global-mcps.ts`
- `cli/scripts/emit-mcp-policy.ts`
- `cli/scripts/emit-agent-shell-tools.ts`
- `cli/scripts/browser.ts` — session browser rail
- `cli/scripts/google-workspace.ts` — Sheets Docs Slides Calendar Gmail Drive
- `cli/scripts/speak.ts` — TTS
- `cli/scripts/listen.ts` — STT
- `cli/scripts/setup.ts` — handheld speak / listen / google-workspace / browser (`~/.workerstack/`)
- `cli/scripts/doctor.ts` — unified prereqs; `globals` row (ok or first drift line); optional google-workspace (`oauth` `tokens` `adc` `clasprc`), speak, clasp, ffmpeg, whisper-cli
- `cli/env/` — the `@workerstack/repo/env` module (`index` exports; `define` merge and views; `keys` identities and the keys file; `age` encrypt and decrypt); `cli/env.ts` holds `defineEnv` and `sealed`, which decrypt in a bun child
- `cli/repo-env.ts` — this repo's own env (`repoEnv`): its process variables; add a name there to read one
- `cli/secret-reason.ts` — the secret-shape detection (`sk_` prefix, high entropy, credential name) the env check uses
- `cli/scripts/env-command.ts` (+ `.constants.ts`) — `bun repo env` dispatch, usage and exit codes; `env-args.ts` parses the flags; `env-io.ts` is the deps (cwd, stdin, stdout, gh) and the one-line refusal
- `cli/scripts/env-files.ts` — finds the `defineEnv` files, picks one (`--file`, the one declaring the key, the only one) and lists USED BY
- `cli/scripts/env-edit.ts` — `env set`: the AST edit that seals or writes a value into the scope block in place
- `cli/scripts/env-keys.ts` — `env init`, `key import`, `key ci`: the key pair, the keys file and the `gh secret set`
- `cli/scripts/env-values.ts` — `env ls`, `get`, `run`, `export`: masked reads, the child env and dotenv quoting
- `cli/__fixtures__/env-repo.ts` — builds a scratch git repo with a keys file and an env file for the `env-*.test.ts` files
- `cli/check-env-values.ts` (+ `.constants.ts`) — the three `bun repo check` env rules over every file that calls `defineEnv(`: plain secret, key one scope lacks, undeclared process read

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
- `rules/` — path-scoped rules only (each has `paths`), written to the host rule trees; a rule without `paths` is moved by one sync below the `repo:rules` region of its scope's `AGENTS.md` (except one with `overrides`); a stock rule's extra sections go to `<name>-local.md` so the stock text stays live
- `subagents/` — extra agents; one named like a stock agent replaces it
- `skills/` — extra skills, linked into each host tree (a real skill dir found under `.agents/skills` or `.claude/skills` moves here)
- `settings/claude.json` — keys deep-merged into the generated `.claude/settings.json`
- `hooks.jsonc` — replaces the stock hooks whole
- `mcp-policy.jsonc` — deep-merged over the stock MCP policy
- `permissions.json` — path deny rules added to the generated hooks
- `lint-baseline.json` — per file, per rule, the lint problems still allowed; read by `bun repo turn` and `bun repo check`
- `test-times.json` — whole milliseconds per test file, written by `bun repo ci times`; read by the vitest shard sequencer
- `global-settings/` — a payload of the stock's name here (`claude.json`, `codex.toml`, `grok.toml`, `antigravity.json`, `cursor.json`) replaces that stock payload whole in `bun repo yolo` and the `globals` check; the stock manifest stays
- `bench/` — `<name>.bench.ts` specs, a `defineBench` default export each; read by `bun repo bench <name>`, not by sync; root only
- `env.keys.json` — `{ "recipient": "age1…", "repo": "<name>" }`: the age public key `sealed(...)` values are sealed for, and the name of the key file `~/.workerstack/keys/<repo>.key`
- `tmp/` — ignored: `sync.json` (the manifest) and `stage/` (the build dir, removed after each sync)

## Generated (do not hand-edit)
`bun repo sync` writes these from `node_modules/@workerstack/repo` plus `.repo/` for the hosts in `agents.hosts` (default: all five; `HOST_TREES` in `cli/sync/hosts.ts` is the one table). In a consumer they are gitignored and recreated by every `bun install`; in this repo they are committed. `bun repo sync --check` reports drift. Each file sync writes whole opens with a `@generated by @workerstack/repo` header line where its format takes a comment and is left read-only (0444, 0555 for a hook) by every sync; to change one, edit its source in `.repo/` (the layout above) or in the package, then sync. A tracked file with that header that no output names any more is removed, even with no manifest; one under a `__fixtures__` folder is kept, and changing the header line keeps a copy. Files where sync owns only regions (`.gitignore`, `.gitattributes`, `references/INDEX.md`) stay writable. A region opens with `# repo:<name> <hash>` and closes with `# /repo:<name>` (`<!-- repo:<name> <hash> -->` and `<!-- /repo:<name> -->` in markdown); the hash is the first 8 hex of the sha256 of the body sync wrote. Sync never fails on a shared file: it prints one `<path>: <repair>` line on stderr per repair (`converted the old markers to repo:ignore` for the old `# >>> @workerstack/repo` pair, `added the hash to`, `closed`, `opened`, `reordered the markers of`, `rewrote the markers of`, `dropped 1 extra`, `dropped 1 stray marker of`, `moved 1 edited line out of` (kept just below the region), `cut` for a region no version writes any more). A shared path no output names any more has its regions cut and keeps the rest (`--check`: `<path> has regions no output writes`), removed only when nothing but whitespace is left. An invalid or non-object `.vscode/settings.json` is left as is with a warning.
- `AGENTS.md` (the root and each package's) — shared: sync writes only the hashed `repo:rules` region at the top; everything else is your text, tracked and committed. There is no package `CLAUDE.md`. The always-on text over 12 KiB is a warning
- Not written by sync: `.mcp.json` is your tracked file (`bun repo init` writes the first one; sync never writes or deletes it). Every other host's MCP file is built from it, filtered by the MCP policy allow list; a `.repo/mcp.json` or a policy `servers` key is moved into `.mcp.json` by one sync, and `.mcp.json`'s own server wins on a name collision
- claude → `.claude/`: `agents/*`, `settings.json` (MCP keys, hooks, the `.repo/settings/claude.json` merge), `skills/<name>` links
- codex → `.codex/` (`agents/*`, `config.toml` `mcp_servers`, absent when allow empty) and `.agents/skills/<name>` links
- antigravity → `.agents/`: `agents/*`, `skills/<name>` links, `mcp_config.json`, hooks
- grok → `.grok/`: `agents/*`, `config.toml` (project MCP `[[permissions]]` + `[plugins] deny_default`; no `[features]`), `roles/scout.toml` and `hooks/*.json` copied from `agents/grok/`; the hook scripts stay in the package's `cli/scripts/`
- cursor → `.cursor/`: `hooks.json` (hooks-union adds consumer extras), `agents/scout.md`; a real dir, not shipped in the package
- release pack: `.github/workflows/ci.yml` (tracked, whole-file; the e2e job only when the root has a `test:e2e` script, the `consumer` job only for a named public root); also, for a public root with a config `owner` and a GitHub `repository`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/{bug_report,config}.yml` (tracked, whole-file); a hand-written one is refused
- benchmark pack: `.github/workflows/bench.yml` (tracked, whole-file), which `bun repo bench --remote` dispatches with the spec, the OSes and the sha; a hand-written one is refused; also the `/benchmark` skill links in `.agents/skills` and `.claude/skills`
- always: `bunfig.toml`, the `repo:ignore` region of `.gitignore`, the `repo:generated` region of `.gitattributes`, `references/INDEX.md` regions `repo:skills`, `repo:refs`, `repo:packages`, `repo:stack` and `repo:available`, `.repo/lessons/INDEX.md` when lessons exist, `.vscode/tasks.json` (committed in a consumer too)

## Generator divergences
Where `cli/sync/agents/` differs from the rulesync 43.7.0 it replaced:
- YAML 1.2 parsing: `yes` stays a string
- No 80-column folding of long values
- The `agentsmd` and `codexcli` rule targets both fold into `AGENTS.md` only
- A leading `./` in a claude hook command becomes `"$CLAUDE_PROJECT_DIR"/`
- A bad subagent, or a rule without frontmatter, fails sync
