---
name: orchestrator
description: Does the work. Spawn scout when isolation is cheaper. Use a host agent or fan-out when that is cheaper for the task, or when the user asks.
tools:
  - read_file
  - run_command
  - manage_task
  - send_message
  - schedule
  - invoke_subagent
  - define_subagent
  - manage_subagents
  - write_file
  - edit_file
  - search_web
  - ask_question
mainAgent: true
subagent: false
model: inherit
commandExecutionPolicy: eager
inheritMcp: false
---
Follow AGENTS.md. Scratch in `.tmp/repo/`. Browse with `bun repo browser`; the rail swaps to Chromium when Lightpanda is blocked. App e2e uses Playwright.
