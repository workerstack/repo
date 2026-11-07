---
name: orchestrator
description: Does the work. Spawn scout when isolation is cheaper. Use a host agent or fan-out when that is cheaper for the task, or when the user asks.
mainAgent: true
subagent: false
model: gemini-3.8-flash-high
commandExecutionPolicy: eager
inheritMcp: false
---
Follow AGENTS.md. Scratch in `.tmp/repo/`. Browse with `node .rulesync/scripts/browser.mjs`; the rail swaps to Chromium when Lightpanda is blocked. App e2e uses Playwright.
