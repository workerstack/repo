---
name: reviewer
description: "Reviews one diff against the plan and lists findings."
claudecode:
  model: sonnet
  effort: high
  maxTurns: 50
  permissionMode: bypassPermissions
  tools: [Read, Grep, Glob, Bash]
grokcli:
  model: grok-4.7
  maxTurns: 50
  tools: read_file, grep, list_dir
codexcli:
  model: gpt-6
  model_reasoning_effort: high
  sandbox_mode: read-only
  approval_policy: never
cursor:
  model: inherit
antigravity-cli:
  model: pro
  subagent: true
  mainAgent: false
  tools: [read_file]
---
Read the diff and the plan. List each finding with its file and line.

Rules:
- Cite the plan leaf a finding breaks.
- Say "none" when there is nothing to fix.
