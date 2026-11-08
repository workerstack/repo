# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `workerstack.config.ts` with `defineConfig` from `@workerstack/repo` declares a repo's packs, and an unknown key or pack fails with a message that names it. `repo sync` writes `bunfig.toml` (hoisted linker, and no auto-install, so a missing import fails instead of fetching from the registry), the `# >>> @workerstack/repo` block in `.gitignore`, and the `repo:packages` and `repo:stack` sections of `references/INDEX.md`. It checks everything before writing anything and refuses to overwrite a hand-written `bunfig.toml`. `repo sync --check` fails on drift, and `repo sync --postinstall` prints errors without failing the install. `repo init` writes `workerstack.config.ts` when it is missing and adds `repo sync --postinstall` to the `postinstall` script.
- Strict tsconfig bases with ts-reset built in: extend `@workerstack/repo/tsconfig/base`, `bun`, `worker` or `web` and list your sources under `include`. `JSON.parse`, `.json()` and similar calls then return `unknown` instead of `any`. The `bun` base brings Bun's types with it. The `worker` base needs `@cloudflare/workers-types` installed in your repo.
- A shared vitest preset: `defineProject` for a package's `vitest.config.ts` and `defineConfig` for a root config, both from `@workerstack/repo/vitest`. They set 5s test and hook timeouts (60s on Windows) and the forks pool, and `defineConfig` adds v8 coverage. Your own settings win. Install `vitest` and, for coverage, `@vitest/coverage-v8` (both ^3.2.7), and run the tests with node.
- `repo check` now also fails when a tsconfig drops ts-reset: one that sets `files`, which replaces the base's, or one that extends no base. It prints one line per file and exits 1. A solution-style root with `"files": []` and `references` passes. The `repo` command now runs on bun, so bun must be on your PATH.

### Changed

- **Breaking:** every script, hook and the CLI is TypeScript run by bun. `.rulesync/scripts/*.mjs` became `.rulesync/scripts/*.ts`, the grok hooks became `.grok/hooks/*.ts`, and the bin is `bin/repo.ts`. Generated hook commands read `bun "$d/…ts"`, and `.githooks/commit-msg` runs under `bun`. The old `.mjs` paths are gone, so call `bun .rulesync/scripts/<name>.ts` and, after `repo init` upgrades a repo, delete the stale `.rulesync/scripts/*.mjs` copies it leaves behind. A consumer's own hook script keeps whatever extension bun runs. `repo doctor` gains a `bun` version row and finds node only on your PATH.
- The stock references moved from `.rulesync/reference/` to `references/` and ship in the package. Agents read them from `node_modules/@workerstack/repo/references/`, so `AGENTS.md` and the skills point there, and `repo init` no longer copies them. `law.md`, `skills-map.md` and `refs-map.md` are gone: `references/INDEX.md` holds the catalogs in its `repo:skills`, `repo:refs`, `repo:packages` and `repo:stack` sections. `repo init` deletes the unchanged stock copies an older init left in `.rulesync/reference/` and prints a note for each file of yours it keeps.
- The `repo` bin runs on bun.
- Scripts and hooks run through the `repo` bin. Agents and people run `bun repo <cmd>` (`job`, `worktree`, `lessons`, `browser`, `google-workspace`, `jev`, `listen`, `speak`, `setup`, `doctor`, `clean`, `sync-globals`, `purge-mcps`, `tasks`, `map`), and every generated hook runs `"$d/node_modules/.bin/repo" hook <name>`, which prints `run bun install` and exits 1 in a checkout with no install. The gate rewrites fat calls to `<root>/node_modules/.bin/repo job …`, the `repo:*` package scripts call `repo <cmd>`, and the hooks check fails a repo hook still in the script form. Direct `bun .rulesync/scripts/<name>.ts` calls still run but are no longer documented. Never type `bunx repo`, which fetches an unrelated npm package.
- The gate now covers Antigravity 1.5.3's `write_file` and `edit_file` and reads its `lastUserInput` for a named git subcommand (a subagent gets no grant); generated agents name models their CLIs accept (`gpt-6-luna`, `grok-4.7`, the Antigravity tiers `flash_lite`, `flash` and `pro`; Cursor agents inherit the parent session's model) with Antigravity's real tool names, and `repo doctor` gains an `agent models` row that flags a model a CLI no longer offers.
- Agents never change product files in the main checkout: the gate denies a write, a commit, destructive git and a lesson save there, and a force push, a delete of the default branch or another session's `wt/*`, unless the user's message names the git command. Work starts with `worktree.mjs add <name>`, and the new `worktree.mjs finish [<name>]` rebases the branch onto the default branch, fast-forwards it and removes the worktree, without pushing. `repo doctor` lists a `stale worktree` unmerged for 7 days

### Fixed

- Antigravity loads the generated agents again (agy rejected their `gemini-3.8-flash-*` models and dropped every agent), and the Antigravity orchestrator can run commands, edit files and invoke subagents.
