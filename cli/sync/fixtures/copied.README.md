# Copied-install fixture (`copied.tgz`)

A consumer repo as `repo init` of `@workerstack/repo` at commit `e7d680e` (the base of plan 12) left it, plus content
the consumer added. It is stored packed, because a live `.claude/skills` or `AGENTS.md` under the repo is discovered by agent harnesses as the
repo's own. `cli/sync/migrate.test.ts` extracts it into a temp dir with the `tar` package; nothing here is used at runtime.

## How it was made

1. `git archive e7d680e | tar -x -C <scratch>/base`, then `bun install` and `bun pm pack --destination <scratch>/pack` there.
2. In an empty `git init` dir with `package.json` (`name`, `private`, `type: module`) and `HOME`, `XDG_CONFIG_HOME`,
   `XDG_DATA_HOME`, `XDG_CACHE_HOME` pointed at scratch dirs (no real global settings are touched):
   `bun add -d @workerstack/repo@file:<scratch>/pack/workerstack-repo-0.0.0.tgz`, then
   `bun node_modules/@workerstack/repo/bin/repo.ts init --yes --packs none`.
3. Added by hand, the consumer's own content:
   - rule `.rulesync/rules/team.md`
   - subagent `.rulesync/subagents/reviewer.md`
   - skill `.agents/skills/deploy/SKILL.md` and its link `.claude/skills/deploy`
   - `.claude/settings.json` key `permissions.allow: ["Bash(make lint:*)"]`
   - an `AGENTS.md` line after the guarded block
   - lesson `.rulesync/lessons/x.md` and `.rulesync/lessons/INDEX.md`
   - `.rulesync/reference/deploy.md`, and `.rulesync/reference/hooks.md` (a copy of the stock file plus `## Our hooks`);
     init at that commit does not create `.rulesync/reference/`
   - a `postToolUse` entry in `.rulesync/hooks.jsonc`
   - `allow` and `servers` in `.rulesync/mcp-policy.jsonc`
   - `.rulesync/repo.features.jsonc` set to `{ "packs": ["listen"] }`
4. Packed the tree, links included, with `tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - . | gzip -n -9 > copied.tgz`.

## What was left out

- `node_modules/` and `.git/`: the tests create both (a link to this repo as the stock package, and `git init`).
- `bun.lock`: it names the scratch tarball path.
- `package.json` names `@workerstack/repo` as `^0.0.0` instead of the scratch tarball path.
- Nothing else: all 156 files (README excluded, it is `copied.README.md`) and 51 links stay (745 KB unpacked, 211 KB packed), because the stock copies in `.rulesync/scripts`,
  `.rulesync/global-settings`, `.agents/skills`, `.claude`, `.codex`, `.cursor`, `.grok` are what the migration removes
  and untracks, and the tests assert they are gone.
