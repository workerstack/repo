---
name: jev
description: >-
  Yes/no or named-option decision on text already saved. Run bun repo jev --available first. On yes, one decision call. On no, decide
  yourself and do not mention Jev.
---
# jev

Use this when the source text is already saved and the leftover question is a yes/no or a choice among options the research already named. Spec: `node_modules/@workerstack/repo/references/jev.md`.

Run `bun repo jev --available`. It prints `yes` or `no` and exits 0.

`no`: answer the question yourself. Do not run a decision call. Do not mention Jev, a missing key, or setup.

`yes`: read `node_modules/@workerstack/repo/references/jev.md`. Write the passage and one questions file under `.repo/scratch/jev/`. Run `bun repo jev --state <state> --questions <questions>` once. Use the printed label and confidence. A low confidence is the result. Do not call again.

Open research, code, and job stay with the session. If the decision call exits non-zero, answer from the sources. Do not invent a label.
