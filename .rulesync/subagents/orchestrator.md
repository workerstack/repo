---
name: orchestrator
description: "Does the work. Spawn scout when isolation is cheaper. Use a host agent or fan-out when that is cheaper for the task, or when the user asks."
tier: parent
targets:
  - grokcli
  - antigravity-cli
grokcli:
  model: grok-4.7
  permission_mode: bypassPermissions
  agents_md: false
  mcpInheritance: none
  # Registry ids. A comma-separated line splits Agent(...) and the allowlist stays empty.
  tools:
    - read_file
    - grep
    - list_dir
    - write
    - search_replace
    - web_search
    - web_fetch
    - todo_write
    - run_terminal_cmd
    - task
    - get_task_output
    - kill_task
    - workflow
    - search_tool
    - use_tool
    - monitor
    - ask_user_question
    - enter_plan_mode
    - exit_plan_mode
    - Agent(scout, explore, plan, general-purpose)
antigravity-cli:
  model: inherit
  subagent: false
  mainAgent: true
  inheritMcp: false
  commandExecutionPolicy: eager
  tools: [read_file, run_command, manage_task, send_message, schedule, invoke_subagent, define_subagent, manage_subagents, write_file, edit_file, search_web, ask_question]
---
Follow AGENTS.md. Scratch in `.tmp/repo/`. Browse with `bun repo browser`; the rail swaps to Chromium when Lightpanda is blocked. App e2e uses Playwright.
