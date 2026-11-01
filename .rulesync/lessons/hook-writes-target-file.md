---
name: hook-writes-target-file
paths: [".grok/hooks/orchestrate-parent.js",".rulesync/scripts/persist-*.mjs",".rulesync/scripts/lessons.mjs"]
hits: 1
last-hit: 2026-11-01
evidence: ["plan 16"]
---

# A pre-tool hook must not write the file the tool is about to write

Writing an existing target inside PreToolUse makes Claude Code refuse the Write as modified since read.

## Mistake
The plan update path wrote the saved plan in the hook and then returned `updatedInput` for the same path. Claude Code checks that a file is unchanged since it was read, saw the hook's write, and refused the tool call, so the agent got an error even though the update was on disk. `persistRoadmap` with an existing `filePath` still does this for roadmap re-saves.

## Fix
On an update, validate and return the content in `updatedInput`; let the host write it. Write in the hook only to reserve a new file (a fresh serial). A file the hook derives from the update, like a lessons `INDEX.md`, may be written in the hook. Prove it with a live Read then Write of a saved file, not only a hook unit test.
