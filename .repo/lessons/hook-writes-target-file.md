---
name: hook-writes-target-file
paths: ["cli/scripts/orchestrate*.ts","cli/scripts/persist-*.ts","cli/scripts/lessons*.ts"]
hits: 1
last-hit: 2026-11-01
evidence: ["plan 16"]
---

# A pre-tool hook must not write the file the tool is about to write

## Mistake
The plan update path wrote the saved plan inside PreToolUse, then returned `updatedInput` for the same path. Claude Code saw the file changed since it was read and refused the tool call.

## Fix
On an update, validate and return the content in `updatedInput`; the host writes it. Write in the hook only to reserve a new file, or a file derived from the update, like a lessons `INDEX.md`. Prove it with a live Read then Write of a saved file.
