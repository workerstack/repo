---
description: Text to speech
---

# Speak

Text-to-speech from the session. Output only. Not STT. Not a mic. Not MCP. Speech-to-text is `/listen`: `node_modules/@workerstack/repo/references/listen.md` and `bun repo listen`.

```
bun repo speak whoami
bun repo speak voices [--provider elevenlabs|openai]
bun repo speak say --text "hello" [--provider elevenlabs|openai] [--voice ID] [--out path] [--play]
```

`say` writes an mp3 under `.tmp/repo/speak/` (or `--out`) and prints the path. `--play` is local `afplay` (mac) or `ffplay`.

## Auth

Handheld (any OS): `bun repo setup speak` or `bun repo setup` → speak. Opens the key page, hides the paste, writes `~/.workerstack/speak.json`, verifies. Non-TTY: `--elevenlabs-key` / `--openai-key`.

If a key is missing or rejected, the CLI prints `setup: bun repo setup speak` and exits 1. Agents should show that line, not a stack or JSON. Do not invent a key.

One key is enough. Never commit it.

| | env | file |
| --- | --- | --- |
| ElevenLabs | `ELEVENLABS_API_KEY` | `elevenlabs.apiKey` |
| OpenAI | `OPENAI_API_KEY` | `openai.apiKey` |
| Force provider | `SPEAK_PROVIDER` | `provider` |

`~/.workerstack/speak.json` (chmod 600):

```json
{
  "provider": "elevenlabs",
  "elevenlabs": {
    "apiKey": "sk_…",
    "voiceId": "JBFqnCBsd6RMkjVDRZzb",
    "modelId": "eleven_multilingual_v2"
  },
  "openai": {
    "apiKey": "sk-…",
    "voice": "coral",
    "model": "gpt-4o-mini-tts"
  }
}
```

Env wins over the file. Default provider is `SPEAK_PROVIDER` else the first configured key (elevenlabs, then openai).

## Defaults

- ElevenLabs voice: George `JBFqnCBsd6RMkjVDRZzb`. Model: `eleven_multilingual_v2`.
- OpenAI voice: `coral`. Model: `gpt-4o-mini-tts`.
- Format: mp3.

Create an ElevenLabs key at https://elevenlabs.io/app/settings/api-keys. OpenAI at https://platform.openai.com/api-keys.

Doctor reports speak as optional: `ok` when a key or `~/.workerstack/speak.json` exists, else `missing (optional)`. It prints the provider name, not the secret.
