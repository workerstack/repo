# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `workerstack.config.ts` with `defineConfig` from `@workerstack/repo` declares a repo's packs, and an unknown key or pack fails with a message that names it. `repo sync` writes `bunfig.toml` (hoisted linker), the `# >>> @workerstack/repo` block in `.gitignore`, and the `repo:packages` and `repo:stack` sections of `references/INDEX.md`. It checks everything before writing anything and refuses to overwrite a hand-written `bunfig.toml`. `repo sync --check` fails on drift, and `repo sync --postinstall` prints errors without failing the install. `repo init` writes `workerstack.config.ts` when it is missing and adds `repo sync --postinstall` to the `postinstall` script.

### Changed

- The `repo` bin runs on bun.
- The gate now covers Antigravity 1.5.3's `write_file` and `edit_file` and reads its `lastUserInput` for a named git subcommand (a subagent gets no grant); generated agents name models their CLIs accept (`gpt-6-luna`, `grok-4.7`, `gemini-3.8-flash-*`; Cursor agents inherit the parent session's model) with Antigravity's real tool names, and `repo doctor` gains an `agent models` row that flags a model a CLI no longer offers.
- Agents never change product files in the main checkout: the gate denies a write, a commit, destructive git and a lesson save there, and a force push, a delete of the default branch or another session's `wt/*`, unless the user's message names the git command. Work starts with `worktree.mjs add <name>`, and the new `worktree.mjs finish [<name>]` rebases the branch onto the default branch, fast-forwards it and removes the worktree, without pushing. `repo doctor` lists a `stale worktree` unmerged for 7 days
