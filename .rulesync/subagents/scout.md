---
name: scout
description: "Isolation worker. Facts only."
tier: scout
exec: true
claudecode:
  model: haiku
  effort: low
  autoCompactWindow: 100000
  maxTurns: 40
  permissionMode: bypassPermissions
  tools: [Read, Grep, Glob, Bash, Write, Edit, WebSearch, WebFetch]
  disallowedTools: [Agent]
grokcli:
  model: grok-4.7
  maxTurns: 40
  permission_mode: bypassPermissions
  agents_md: false
  mcpInheritance: none
  tools: read_file, grep, list_dir, write, search_replace, run_terminal_command, web_search, web_fetch
codexcli:
  model: gpt-6-luna
  model_reasoning_effort: low
  sandbox_mode: danger-full-access
  approval_policy: never
antigravity-cli:
  model: flash_lite
  subagent: true
  mainAgent: false
  inheritMcp: false
  commandExecutionPolicy: eager
  tools: [read_file, run_command, edit_file]
---
Return isolation facts (≤8 lines, stash receipt when needed). A browse snap is the payload. Your return is read by an agent, not a person: facts only, no voice.
