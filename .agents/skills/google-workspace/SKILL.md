---
name: google-workspace
description: >-
  Google Sheets, Docs, Slides, Calendar, Gmail via bun repo google-workspace.
---
# google-workspace

When the user wants a Google sheet, doc, slide, meeting, or mail, run `bun repo google-workspace`. Spec: `.rulesync/reference/google-workspace.md`. If Calendar/Gmail/sheet set fail or login is missing, tell them to run `bun repo setup google-workspace` (TTY) for the handheld walk. Do not share creds. Do not invent OAuth JSON. Do not ask them to write Apps Script.

`whoami` · `scopes` · `accounts` · `login` · `sheet create|set|get|append|clear` · `doc create|append` · `drive list` · `slide create` · `meeting create [--attendees a@b,c@d]` · `mail send|list`. `--account NAME` for a second Google user on this machine.

Auth: `bun repo setup google-workspace` then `login` as needed. Two Google users on one machine: `--account NAME`. Creds stay in `~/.workerstack/` (or `~/.workerstack/workspace/NAME/`). Do not share OAuth JSON or tokens. Doctor: `bun repo doctor` reports google-workspace as optional (`oauth` `tokens` `adc` `clasprc`; no secrets). `clasprc` is Drive-only. Spec: `.rulesync/reference/google-workspace.md` `.rulesync/reference/setup.md`.
