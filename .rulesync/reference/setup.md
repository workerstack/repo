---
tags: [setup]
---

# Setup

Handheld machine setup for optional integrations. Any OS. Secrets stay in `~/.grunt/` (Windows `%USERPROFILE%\.grunt`). Not git. Env still wins over the file.

```
npm exec grunt setup
node scripts/setup.mjs
node scripts/setup.mjs speak
node scripts/setup.mjs listen
node scripts/setup.mjs google-workspace
node scripts/setup.mjs browser
```

TTY: menu with ok/missing. Already ok asks redo (`--redo` skips the ask). Missing bins: print the OS command (never run it), then re-check PATH. Ends with a four-line status. Non-TTY needs flags (keys / `--creds`). Doctor never installs bins; setup never installs bins either.

| target | what it writes | flags |
| --- | --- | --- |
| speak | `~/.grunt/speak.json` | `--elevenlabs-key` `--openai-key` `--provider` `--skip-verify` |
| listen | same file (`openai` / `listen`) plus `~/.grunt/whisper/` | `--openai-key` `--device` `--skip-download` |
| google-workspace | Desktop OAuth JSON + tokens under `~/.grunt/` | `--creds PATH` `--account NAME` `--project ID` |
| browser | nothing (print Lightpanda / Chromium hints; both required except win32 Chromium-only) | |

Do not invent keys. If the session is not a TTY, tell the user to run `grunt setup` in their terminal. This spec is enough. Do not read https://github.com/lovrozagar/grunt#readme unless this file is missing.
