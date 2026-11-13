---
description: Set up integrations
---

# Setup

Handheld machine setup for optional integrations. Any OS. Secrets stay in `~/.workerstack/` (Windows `%USERPROFILE%\.workerstack`). Not git. Env still wins over the file.

```
bun repo setup
bun repo setup speak
bun repo setup listen
bun repo setup google-workspace
bun repo setup browser
bun repo setup jev
```

TTY: menu with ok/missing. The menu lists enabled packs and always lists browser and jev. A pack is enabled when `agents.skills` in `workerstack.config.ts` names it. `bun repo setup <pack>` when that pack is off prints how to enable it (add it to `agents.skills`, then `bun repo sync`) and exits 1. Already ok asks redo (`--redo` skips the ask). Missing bins: print the OS command (never run it), then re-check PATH. Ends with one status line per listed target. Non-TTY needs flags (keys / `--creds`). Doctor never installs bins; setup never installs bins either.

| target | what it writes | flags |
| --- | --- | --- |
| speak | `~/.workerstack/speak.json` | `--elevenlabs-key` `--openai-key` `--provider` `--skip-verify` |
| listen | same file (`openai` / `listen`) plus `~/.workerstack/whisper/` | `--openai-key` `--device` `--skip-download` |
| google-workspace | Desktop OAuth JSON + tokens under `~/.workerstack/` | `--creds PATH` `--account NAME` `--project ID` |
| browser | nothing (print Lightpanda / Chromium hints; both required except win32 Chromium-only) | |
| jev | `~/.workerstack/jev.json` (`apiKey`, mode 0600). `TYPESAFE_API_KEY` wins when set | `--api-key` |

## Full-permission defaults

`bun repo init` and `bun repo yolo` merge full-permission keys into six machine-wide files, keeping every other key (skip with `--skip-globals`). Plain `claude`, `codex`, `grok`, `agy`, `cursor-agent` and `opencode` then start without approval prompts; there are no `repo:<agent>` launch scripts.

| host | dest under `$HOME` | keys |
| --- | --- | --- |
| claude | `.claude/settings.json` | `permissions.defaultMode = "bypassPermissions"`, `skipDangerousModePermissionPrompt = true` |
| codex | `.codex/config.toml` | `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` |
| grok | `.grok/config.toml` | `[ui] permission_mode = "always-approve"` plus the orchestrator, subagent, memory and `[features]` tables |
| antigravity | `.gemini/antigravity-cli/settings.json` | `toolPermission = "always-proceed"` |
| cursor | `.cursor/cli-config.json` | `approvalMode = "unrestricted"` |

`bun repo yolo` applies by default; `--dry-run` previews, `--check` prints one line of per-host status, exits 1 on any drift, and `--host <id>` limits it to one host; an unknown id prints `unknown host: <id>` and a deleted payload prints `missing payload: <path>`. `bun repo doctor` shows one `globals` row: `ok`, or the first drift line, which names the host, dest and key and ends with the `bun repo yolo` hint. The project hooks (gate-fat-tools, scrub-spawn-prompt) still run in bypass mode.

opencode (V2) has no yolo flag: its payload is one allow-all rule in `permissions` of `~/.config/opencode/opencode.json`. The merge puts that rule ahead of the rules already there, so a user's own `deny` or `ask` still wins, and a second run adds nothing. A dest whose `permissions` is not a list, or one with an `opencode.jsonc` beside it (the file opencode reads), is left as is: apply prints `skip opencode .config/opencode/opencode.json: <reason>`, `--check` prints `opencode skipped: <reason>` and exits 1.

`bun repo shim` installs a bare `repo` launcher once per machine, so a command runs without the `bun` prefix. It writes a launcher into `~/.local/bin` (Windows: `%LOCALAPPDATA%\workerstack\bin`, with `repo.mjs` and `repo.cmd` beside it for cmd.exe and PowerShell). From any directory the launcher runs the nearest parent's `node_modules/@workerstack/repo`, so each project keeps its own version; outside a project it prints `repo: no @workerstack/repo found above <dir>; run \`bun install\` in the project` and exits 1. `--dry-run` previews, `--check` exits 1 on a missing or stale file, `--dir <path>` installs elsewhere. When the directory is not on PATH it prints the line to add (bash and zsh, fish, or PowerShell); it never edits PATH or a shell rc file. Rerun it after upgrading the package: `bun repo doctor` shows a `shim` row (`ok`, `not installed` or `stale`). bun must be on PATH, as for `bun repo`.

Do not invent keys. If the session is not a TTY, tell the user to run `bun repo setup` in their terminal. This spec is enough. Do not read https://github.com/workerstack/repo#readme unless this file is missing.
