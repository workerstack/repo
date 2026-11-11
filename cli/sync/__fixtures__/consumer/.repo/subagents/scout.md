---
name: scout
overrides: scout
description: "Consumer scout. Reads files and reports facts."
tier: scout
exec: true
claudecode:
  model: haiku
  effort: low
  maxTurns: 20
  tools: [Read, Grep, Glob, Bash]
  disallowedTools: [Agent]
grokcli:
  model: grok-4.7
  maxTurns: 20
  tools: read_file, grep, list_dir, run_terminal_command
codexcli:
  model: gpt-6-luna
  model_reasoning_effort: low
  sandbox_mode: read-only
antigravity-cli:
  model: flash_lite
  subagent: true
  mainAgent: false
  tools: [read_file, run_command]
---
Report what the files say. Keep it under eight lines.

End with one line:
status: done|stuck
