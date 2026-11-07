---
tags: [hooks]
---

# Hooks

SessionStart carries only the folder map: Claude / Codex run `../../.rulesync/scripts/session-map.mjs`, which injects the code-only map from `../../.rulesync/scripts/folder-map.mjs` as `additionalContext` (capped under Claude Code's 10,000-char per-hook `additionalContext` limit, about 2.4k tokens, below the 5k `repo map` budget; cache-stable, fail-open) and logs `{rows, tokens}` to `.tmp/repo/sessions/<sid>/map.json`. Inject nothing else at SessionStart. Antigravity has no rulesync sessionStart. Do not register a SessionStart hook on `../../.grok/hooks/orchestrate-parent.json`.

Grok PostToolUse / SessionStart are observe-only — do not attempt output scrub; compress via RTK / spawn / isolation facts only. Do not add PostToolUse scrub hooks. UserPromptSubmit may emit a one-line `sessionGate=auto|ask` plus session receipt, then up to 8 other live lines from `~/.workerstack/board/` (`hookSpecificOutput.additionalContext`). The current session's own line is omitted. Skip host Stop banners. `/ask` exact-match slash stamps `session-gate-{sid}` to `ask`. `/auto` unlinks. Sid-less: no stamp. Default: `auto`.

In `sessionGate=ask`, parent Stop on `end_turn` blocks unless the recap asks (`?`) or is exactly `[orchestrator]: wait scout`. Reason: `ask after this step`. Cap 3. `sessionGate=auto` does not Stop-block.

Claude / Codex / Antigravity / Cursor PreToolUse still run `../../.rulesync/scripts/scrub-spawn-prompt.mjs` and `../../.rulesync/scripts/gate-fat-tools.mjs`. Grok spawn/fat rewrite is `../../.grok/hooks/orchestrate-parent.js`. RTK stays `../../.grok/hooks/rtk.json`.
Claude Code's `WorktreeCreate` and `WorktreeRemove` come from the `claudecode` block of `hooks.jsonc` and run `../../.rulesync/scripts/worktree.mjs hook` (60s), so its worktrees land in `.worktrees/<name>` on `wt/<name>`. Other harnesses have no such event and call `worktree.mjs add` directly.

## Cursor

`cursor-agent` reads `.cursor/hooks.json` (JSONC, `version: 1`, camelCase events `preToolUse` `beforeSubmitPrompt` `stop` `sessionStart`, flat `{command, timeout, matcher}` entries). `rulesync generate -t cursor -f hooks` writes it from `hooks.jsonc` with the matchers untranslated, so the gate and orchestrate-parent matchers name Cursor's tools (`Shell`, `Read`, `Write`, `Grep`) beside the others. `hooks-union.mjs` appends a consumer's autorun scripts to it as flat entries (`Write` is Cursor's write matcher). Cursor also reads `.claude/settings.json` hooks and drops a command it already has in its own file, so nothing runs twice. Cursor refuses a hook file with a symlink on its path: keep `.cursor/` a real dir. It reads `AGENTS.md`, so there is no `.cursor/rules`. `.cursor` is generated in each consumer and is not in the package `files` or init's copied dirs.

Payload: `cursor_version`, `session_id`, `model`, `tool_name`, `tool_input`, `cwd`; no `turn_id`, no `subagent_type` (every Cursor call counts as the parent). `gate-fat-tools.mjs` `harnessOf` tests a string `cursor_version` first, because `session_id` and `model` also match the Codex check. Tools the gate answers:

| Tool | Input | Gate |
| --- | --- | --- |
| `Shell` | `command`, `cwd` | denylist, `.gitignore`, `git worktree add` guards; dump, search, `curl` and `ls` rewrites |
| `Read` | `file_path` | denylist, 200KB deny, re-read deny |
| `Grep` | `pattern`, `file_path`, `glob` | denylist |
| `Write` | `file_path`, `content` | scratch redirect to the root `.tmp/repo`, `.gitignore` guard; orchestrate-parent persists plans and the like |

`Read` takes no offset or limit and `Grep` no `head_limit`, so the gate injects and caps neither (`limits: false` in `TOOLS.cursor`). A re-read of a file this session wrote therefore cannot say "Read with offset+limit": Cursor's reason names `node .rulesync/scripts/job.mjs --job exec --query 'sed -n 1,200p <file>'`. `List` and `Delete` get no answer.

Reply: a deny is `{"permission":"deny","user_message":reason,"agent_message":reason}`. A rewrite is Claude's nested `{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{...}}}` with no `permission` and no top-level field (Cursor reads the nested form only then; `permission` would also auto-approve). Cursor applies a rewritten `command` (Shell) and `file_path` (Write), but writes its own `content`: a persisted tmp write lands at the `.tmp/repo/` path with its `TMP_NAME:` line still in the body. Empty stdout with exit 0 allows. Invalid JSON on stdout blocks the call. `stop` may reply `{"decision":"block","reason":...}`. orchestrate-parent knows only Claude's `UserPromptSubmit`, so Cursor's `beforeSubmitPrompt` is a no-op there (no `/ask` stamp, no board line).

Session agent tools are on. Fat Read/Grep/Glob/Bash still gate. Writes under `.tmp/repo/plans/`, `.tmp/repo/handoffs/`, `.tmp/repo/implementations/`, `.tmp/repo/roadmaps/`, and `.tmp/repo/` root files persist via `../../.rulesync/scripts/persist-plan.mjs` / `persist-handoff.mjs` / `persist-implementation.mjs` / `persist-tmp.mjs` / `persist-roadmap.mjs`. The hook hands the host the absolute path of the saved file. Invalid body denies. A Write of a saved plan updates that file in place (same serial); an Edit of a saved plan is checked against the text it would produce, and a valid one runs as sent. `## Previous mistakes` entries are append-only on both. Roadmaps follow the same rules: a Write of a saved roadmap is validated and the host writes it, and an Edit is checked against the text it would produce.

Writes under `.rulesync/lessons/` go through `../../.rulesync/scripts/lessons.mjs`: a lesson Write is validated, saved, and reindexed (`INDEX.md`); an Edit of a lesson is denied with the Write and `lessons.mjs hit` routes. On any other Write or Edit, PreToolUse adds `additionalContext` for lessons whose globs match the file, each once per session (`.tmp/repo/sessions/<sid>/lessons-seen.json`). It reads only `INDEX.md` and fails open.

SubagentStop (and child Stop with `subagentType`) intercepts a parseable `need:` whose jobs are all `search|exec|slice|fetch` (cap 4): runs job in-hook and continues the child with concatenated facts. Mixed/web/test, parse fail, FALLBACK, `stopHookActive`, or more than 3 intercepts per child session → empty stdout (allow stop).

Stop and SubagentStop timeout is 30s (job cap is 20s). PreToolUse / UserPromptSubmit stay at 5s.

rulesync canonical event is `beforeSubmitPrompt` (→ Claude/Codex `UserPromptSubmit`), not `userPromptSubmit`.

`[features] two_pass_compaction` must live in `~/.grok/config.toml` (from `.rulesync/global-settings/grok.toml` via `bun run sync:globals` / `bun run sync:globals:apply`). Project `.grok/config.toml` cannot set `[features]`.
