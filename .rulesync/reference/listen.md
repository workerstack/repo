---
tags: [listen]
---

# Listen

Speech-to-text from the session. Input only. Not TTS. Not a live voice agent. Not MCP.

```
node scripts/listen.mjs whoami
node scripts/listen.mjs devices
node scripts/listen.mjs rec [--seconds 8] [--device D] [--clip]
node scripts/listen.mjs start [--device D]
node scripts/listen.mjs stop [--clip]
node scripts/listen.mjs toggle [--clip]
node scripts/listen.mjs status
node scripts/listen.mjs file --path clip.wav [--clip]
node scripts/listen.mjs latest
```

`rec` records then transcribes (default 8s, cap 120s). `toggle` is the hotkey verb: first run starts, second run stops and prints the transcript. Audio and `latest.txt` live under `.tmp/grunt/listen/`. `--cwd /path/to/repo` when the hotkey does not already run in the repo.

## Auth and capture

If ffmpeg, whisper-cli, a ggml model, or `OPENAI_API_KEY` is missing, the CLI prints `setup: .rulesync/reference/listen.md` and exits 1. Agents should show that line, not a stack or JSON.

STT prefers **local whisper.cpp**. Install the binary; the first `listen` downloads `ggml-base.en.bin` (~142MB) into `~/.grunt/whisper/`. No API cost after that. If the binary or download is missing, it falls back to OpenAI `whisper-1` (`OPENAI_API_KEY` or `~/.grunt/speak.json`). Force with `LISTEN_STT=local` or `LISTEN_STT=openai`. Never commit keys. Never put them in `.rulesync/grunt.config.jsonc`.

| | env | `~/.grunt/speak.json` |
| --- | --- | --- |
| Local model | `WHISPER_MODEL` | `listen.whisperModel` |
| Force engine | `LISTEN_STT` | `listen.stt` (`auto` / `local` / `openai`) |
| OpenAI key | `OPENAI_API_KEY` | `openai.apiKey` |
| OpenAI model | `LISTEN_MODEL` | `listen.model` (default `whisper-1`) |
| Device | `LISTEN_DEVICE` | `listen.device` |
| Seconds | `LISTEN_SECONDS` | `listen.seconds` |

### Local Whisper (preferred)

One install:

- mac: `brew install whisper-cpp` (provides `whisper-cli`)
- linux: build https://github.com/ggml-org/whisper.cpp (`whisper-cli` on PATH)
- win: whisper.cpp release `whisper-cli.exe` on PATH

Then `node scripts/listen.mjs whoami` or `rec`. The first run fetches `ggml-base.en.bin` to `~/.grunt/whisper/`. Do not pip-install OpenAI Whisper. Do not curl the model yourself unless the auto-download fails.

Larger models: put another `ggml-*.bin` in that folder or set `WHISPER_MODEL`. Doctor reports `whisper-cli` as optional. `whoami` prints `stt=local` or `stt=openai`.

### ffmpeg (mic only)

- mac: `brew install ffmpeg`
- linux: `sudo apt install ffmpeg`
- win: `winget install Gyan.FFmpeg`

`file` and `latest` work without a mic. Doctor reports ffmpeg as optional.

`rec` detaches ffmpeg and does not attach it to the IDE TTY. AVFoundation can stall forever on a VS Code / Electron PTY even when Visual Studio Code already has Microphone access.

Default devices: mac `:0` (AVFoundation audio 0), linux Pulse `default` (ALSA if the id is `hw:…`), Windows requires `--device` or `LISTEN_DEVICE` from `listen devices`.

## Hotkeys

Bind one key to toggle. Include `--clip` so the transcript is on the clipboard as well as `latest.txt`.

```
node /ABS/grunt/scripts/listen.mjs toggle --clip --cwd /ABS/grunt
```

Replace `/ABS/grunt` with the repo root.

- **mac:** Shortcuts (Run Shell Script) or skhd: `hyper - r : node /ABS/grunt/scripts/listen.mjs toggle --clip --cwd /ABS/grunt`
- **win:** PowerToys Keyboard Manager or AutoHotkey: `^!r:: Run, node C:\ABS\grunt\scripts\listen.mjs toggle --clip --cwd C:\ABS\grunt, C:\ABS\grunt, Hide`
- **linux:** desktop custom shortcut or sxhkd to the same command.

No daemon. Each keypress is one CLI. First press records; second press transcribes.

`--clip` uses `pbcopy` (mac), `clip` (win), or `wl-copy` / `xclip` / `xsel` (linux).
