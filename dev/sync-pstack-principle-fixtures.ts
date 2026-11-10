/** Upstream principle skills as pstack publishes them. */
export const ATTACK_UPSTREAM = `---
name: principle-attack-the-premise
description: "Apply when two or more fixes that share one premise have failed the same gate."
disable-model-invocation: true
---

# Attack the Premise

When two or more fixes that share one premise have failed the same gate, suspect the premise, not the fixes.

Make the check rerunnable per [Build the Lever](../principle-build-the-lever/SKILL.md).
The sequencing complement to the **prove-it-works** principle skill.
`;

export const EXPLAIN_UPSTREAM = `---
name: principle-explain-the-number
description: "Apply before you trust, report, or act on a number you measured."
disable-model-invocation: true
---

# Explain the Number

Name the limiter.

For a performance number, run the full procedure with the [benchmark-checklist](../benchmark-checklist/SKILL.md) skill. For an eval result, ask the same of the trials.

Distinct from [Prove It Works](../principle-prove-it-works/SKILL.md), which checks that an output is real.
`;

export const PROVE_UPSTREAM = `---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring done."
disable-model-invocation: true
---

# Prove It Works

Verify every task output by checking the real thing directly.

Keep the artifact visible for the human. Commit it only for large or complex work where the trail has to be auditable later, like a big port or migration (the **show-me-your-work** skill).
`;

export const LEVER_UPSTREAM = `---
name: principle-build-the-lever
description: "Apply to any non-trivial work. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand."
disable-model-invocation: true
---

# Build the Lever

When the work isn't trivial, build the tool that does it instead of doing it by hand.

- When you fan work out to subagents, write the lever as a skill they all read: the recipe, the verification contract, and the do-not-touch fences in one artifact. Keep it outside the delegates' write scope so they can't quietly edit the contract.
`;

export const GUARD_UPSTREAM = `---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
disable-model-invocation: true
---

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.
`;

export const NEVER_UPSTREAM = `---
name: principle-never-block-on-the-human
description: "Apply when tempted to ask 'should I do X?' on reversible work."
disable-model-invocation: true
---

# Never Block on the Human

The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, proceed, and let the human course-correct after the fact. Since code changes are reversible and reviewable, a wrong decision usually costs less than blocking.

- Proceed, then present. Do the work, show the result. Don't ask "should I do X?" Do X, explain why.
- Irreversible actions (force-push, delete production data, send external messages) still require confirmation.
`;
