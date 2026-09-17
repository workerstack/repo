---
name: speak
description: "Text-to-speech via node scripts/speak.mjs (ElevenLabs or OpenAI). Output only."
---
# speak

When the user wants spoken audio, run `node scripts/speak.mjs`. Spec: `.rulesync/reference/speak.md`. Output only (text → mp3). Do not record a mic. Do not transcribe.

`whoami` · `voices` · `say --text T [--provider elevenlabs|openai] [--voice ID] [--out path] [--play]`.

Auth: `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` or `~/.grunt/speak.json`. Do not commit the key. Default voices: ElevenLabs George (`JBFqnCBsd6RMkjVDRZzb`), OpenAI `coral`.

If the CLI exits non-zero, print its message. Lines with `setup:` are for the user — show that path, do not dump JSON, do not invent a key. Spec: `.rulesync/reference/speak.md`.
