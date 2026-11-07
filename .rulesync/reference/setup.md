---
tags: [setup]
---

# Setup

Handheld machine setup for optional integrations. Any OS. Secrets stay in `~/.workerstack/` (Windows `%USERPROFILE%\.workerstack`). Not git. Env still wins over the file.

```
bunx repo setup
node .rulesync/scripts/setup.mjs
node .rulesync/scripts/setup.mjs speak
node .rulesync/scripts/setup.mjs listen
node .rulesync/scripts/setup.mjs google-workspace
node .rulesync/scripts/setup.mjs browser
node .rulesync/scripts/setup.mjs jev
```

TTY: menu with ok/missing. The menu lists enabled packs and always lists browser and jev. A pack is enabled when `.rulesync/repo.features.jsonc` names it. `node .rulesync/scripts/setup.mjs <pack>` when that pack is off prints how to enable it (`repo init` or `repo upgrade`) and exits 1. Already ok asks redo (`--redo` skips the ask). Missing bins: print the OS command (never run it), then re-check PATH. Ends with one status line per listed target. Non-TTY needs flags (keys / `--creds`). Doctor never installs bins; setup never installs bins either.

| target | what it writes | flags |
| --- | --- | --- |
| speak | `~/.workerstack/speak.json` | `--elevenlabs-key` `--openai-key` `--provider` `--skip-verify` |
| listen | same file (`openai` / `listen`) plus `~/.workerstack/whisper/` | `--openai-key` `--device` `--skip-download` |
| google-workspace | Desktop OAuth JSON + tokens under `~/.workerstack/` | `--creds PATH` `--account NAME` `--project ID` |
| browser | nothing (print Lightpanda / Chromium hints; both required except win32 Chromium-only) | |
| jev | `~/.workerstack/jev.json` (`apiKey`, mode 0600). `TYPESAFE_API_KEY` wins when set | `--api-key` |

## Full-permission defaults

`bunx repo init`, `bunx repo upgrade` and `bunx repo sync-globals --apply` merge full-permission keys into five machine-wide files, keeping every other key (skip with `--skip-globals`). Plain `claude`, `codex`, `grok`, `agy` and `cursor-agent` then start without approval prompts; there are no `repo:<agent>` launch scripts.

| host | dest under `$HOME` | keys |
| --- | --- | --- |
| claude | `.claude/settings.json` | `permissions.defaultMode = "bypassPermissions"`, `skipDangerousModePermissionPrompt = true` |
| codex | `.codex/config.toml` | `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` |
| grok | `.grok/config.toml` | `[ui] permission_mode = "always-approve"` plus the orchestrator, subagent, memory and `[features]` tables |
| antigravity | `.gemini/antigravity-cli/settings.json` | `toolPermission = "always-proceed"` |
| cursor | `.cursor/cli-config.json` | `approvalMode = "unrestricted"` |

`bunx repo sync-globals` is the dry-run (`--host <id>` for one host); an unknown id prints `unknown host: <id>` and a deleted payload prints `missing payload: <path>`. `bunx repo doctor` shows one `globals` row: `ok`, or the first drift line, which names the host, dest and key and ends with the `bunx repo sync-globals --apply` hint. `bun run sync:globals:check` exits 1 on drift. The project hooks (gate-fat-tools, scrub-spawn-prompt) still run in bypass mode.

Do not invent keys. If the session is not a TTY, tell the user to run `repo setup` in their terminal. This spec is enough. Do not read https://github.com/workerstack/repo#readme unless this file is missing.
