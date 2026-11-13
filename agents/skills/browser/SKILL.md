---
name: browser
description: >-
  Browse via bun repo browser (Lightpanda). App e2e uses
  Playwright.
---
Zero-config. `bun repo browser <verb>`.

Verbs: `nav <url>` · `snap` · `click <ref>` · `fill <ref> <text>` · `scroll [ref|down|up|N]` · `wait [ms]` · `hover <ref>` · `select <ref> <value>` · `shot` · `pdf` · `stop` · `doctor` · `ensure`.

- **snap** = default read (markdown + numbered refs). `click`/`fill` need a prior snap.
- Lightpanda default. The rail swaps to Chromium when `shot`/`pdf`/`trace`, win32, missing Lightpanda, probe-fail once, Chromium-first hosts (figma docs/sheets/slides mail.google earth amazon), or a blocked/empty/client-rendered snap. One swap. Do not stop and say you cannot.
- Session/profile: `.repo/tmp/browser/`. `stop` reaps; second `stop` ok.
- Windows: Chromium even if Lightpanda exists.
- `doctor`/`ensure` → `bun repo doctor`. Engine hints: `bun repo setup browser`. Do not read a README unless doctor/setup is missing; then https://github.com/workerstack/repo#prerequisites (not the consumer README).
- No env. No MCP. No raw Playwright. Spec: `node_modules/@workerstack/repo/references/browser.md`.
