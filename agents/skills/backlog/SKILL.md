---
name: backlog
description: Keep a gitignored list of things found but not done now, in .repo/backlog.md. Add, list, start, finish, clear.
---
# backlog

`/backlog [text | start N | done N | clear]`. One plain file: `<root>/.repo/backlog.md`. Never committed.

## Root

The file lives in the main checkout, shared by every worktree. Find the root with `git rev-parse --git-common-dir` and take its parent. From a worktree that still names the root file, never `.worktrees/<name>/.repo`.

## Format

An item is one line: a `-` or `*` bullet, a box, a space, text.

```
- [ ] open
- [-] in progress
- [x] done
```

Anything else in the file is the person's own text: headings, notes, blank lines, indented lines. Read it as is. Never move, wrap, reformat or delete it.

## Commands

- `/backlog <text>`: append `- [ ] <text>` as a new last line. Create the file when missing. Never ask a question.
- `/backlog`: print each item as `<line number>  <line>`, open and in progress first. Print nothing else.
- `/backlog start N`: change that item's box to `[-]`.
- `/backlog done N`: change that item's box to `[x]`.
- `/backlog clear`: ask `delete {k} done lines? (y/n)`. On `y`, remove only the `[x]` item lines.

`N` is the line number in the file, or text that matches exactly one item line. The numbers move when the file is edited, so list and act in the same turn.

## Edits

Change only the box characters of the one line you act on. Keep its bullet, indent, text and line ending. Re-read the file right before writing, and append with one write, so a person's edit made a moment ago is not lost.

## When the file is not ideal

- `[X]` counts as done. `-[ ]`, `[]` and `[ ]text` without a space are not items: leave them, and say `{k} lines are not items` after a list.
- `start` or `done` on a line that is not an item stops with `line {N} is not an item`. A number past the end stops with `no line {N} in .repo/backlog.md`.
- Text that matches two or more items stops with their line numbers. Pick one.
- `done` on an item already `[x]` changes nothing and says so.
- A file with no trailing newline gets one before an append. A CRLF file keeps CRLF.
- An empty or missing file lists as `backlog is empty`.

## For agents

When you find something outside the active plan or roadmap, append it as `- [ ] ...` and keep going. Do not fix it, and do not widen the plan. Name the new lines in your closing reply.
