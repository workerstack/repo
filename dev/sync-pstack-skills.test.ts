import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adaptFile,
  parseArgv,
  PSTACK_SKILLS,
  SKILLS_REL,
  syncPstackSkills,
} from "./sync-pstack-skills.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function skill(name: string) {
  return PSTACK_SKILLS.find((s) => s.name === name)!;
}

describe("parseArgv", () => {
  it("defaults generate on", () => {
    expect(parseArgv([])).toEqual({
      ok: true,
      check: false,
      generate: true,
      ref: "main",
      repo: "backnotprop/pstack",
      skills: [],
    });
  });

  it("parses flags", () => {
    expect(parseArgv(["--check", "--no-generate", "--ref", "abc", "--skill", "bro", "--skill", "teach"])).toEqual({
      ok: true,
      check: true,
      generate: false,
      ref: "abc",
      repo: "backnotprop/pstack",
      skills: ["bro", "teach"],
    });
  });

  it("rejects unknown flags", () => {
    expect(parseArgv(["--wat"])).toEqual({ ok: false, error: "unknown flag: --wat" });
  });
});

describe("adaptFile", () => {
  it("ports bro", () => {
    const raw = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.
`;
    const out = adaptFile(skill("bro"), "SKILL.md", raw);
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toBe(`---
name: bro
description: "Restate the last message in plain human language, with no jargon."
---
This reply only: restate the last message in plain human language. Not a mode switch or session flag. After this reply, revert to output.md.

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.

Slash \`/bro\` only.
`);
  });

  it("ports unslop slash-only and keeps rules", () => {
    const raw = `---
name: unslop
description: Cut AI tells from any writing.
disable-model-invocation: true
---

# Unslop

Edit text to remove AI patterns. Scan for the patterns below, then rewrite. Preserve meaning and match the intended tone.

## Patterns to detect and fix

7. **AI vocabulary.** Additionally, crucial, delve.
`;
    const out = adaptFile(skill("unslop"), "SKILL.md", raw);
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("Use for /unslop.");
    expect(out.text).toContain("Slash `/unslop` only. Not a session flag.");
    expect(out.text).toContain("7. **AI vocabulary.** Additionally, crucial, delve.");
    expect(out.text).not.toContain("disable-model-invocation");
  });

  it("rewrites blast-radius pstack-only steps", () => {
    const raw = `---
name: blast-radius
description: "Find what a change could break. Use for 'blast radius of X'."
disable-model-invocation: true
---

# Blast radius

Find what a change breaks somewhere else, before it ships.

Companion to \`how\` and \`why\`. \`how\` tells you what the code does. \`why\` tells you why it's shaped that way. Blast radius tells you what it breaks somewhere else.

1. Read the change. Use \`why\` step 2 to pull the PR and commits.
4. Same rules as \`why\`. Cite a real \`file:line\`, a search that finds nothing is still an answer, and never make up a caller or an API.
6. For a big or wide change, run it as an \`arena\`. Ask more than one model the same question and merge the answers.

Write it through \`unslop\`, cite real code.
`;
    const out = adaptFile(skill("blast-radius"), "SKILL.md", raw);
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain('Use for /blast-radius, \'blast radius of X\'');
    expect(out.text).toContain("This is not a walkthrough of what the code does");
    expect(out.text).toContain("`git log` / `git blame`");
    expect(out.text).toContain("second independent pass");
    expect(out.text).toContain("through `/unslop`");
    expect(out.text).not.toContain("`how`");
    expect(out.text).not.toContain("`arena`");
  });

  it("rewrites correct rule table home", () => {
    const raw = `---
name: correct
description: "Find the mistakes. Use for /correct."
---

# Correct

The operator keeps correcting agents in this repo for the same mistakes. Change the repo so the next agent can't make them.

Last, keep a table in the agent instruction file that pairs each rule with what enforces it.
`;
    const out = adaptFile(skill("correct"), "SKILL.md", raw);
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("`AGENTS.md` (SSOT: `.rulesync/rules/overview.md`)");
    expect(out.text).toContain("Slash `/correct` only.");
  });

  it("inlines typescript principles and extra file", () => {
    const raw = `---
name: typescript-best-practices
description: TypeScript best practices. Use when reading or editing any .ts or .tsx file.
paths: ["**/*.ts", "**/*.tsx"]
disable-model-invocation: true
---

# TypeScript best practices

Apply the **type-system-discipline** principle skill first.

| Rule | Summary |
|------|---------|
| Boundary validation | Parse where data crosses in. See the **boundary-discipline** principle skill. |

Examples: \`references/patterns.md\`.
`;
    const out = adaptFile(skill("typescript-best-practices"), "SKILL.md", raw);
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("Make illegal states unrepresentable.");
    expect(out.text).toContain("or for /typescript-best-practices.");
    expect(out.text).not.toContain("paths:");
    expect(out.text).not.toContain("principle skill");
    expect(out.text).toContain("next to this skill.");

    const patterns = adaptFile(
      skill("typescript-best-practices"),
      "references/patterns.md",
      "# TypeScript patterns\n\nCode examples for each rule in `SKILL.md`. The underlying principles are language-agnostic. See the **type-system-discipline** and **boundary-discipline** principle skills.\n",
    );
    expect(patterns.text).toBe(
      "# TypeScript patterns\n\nCode examples for each rule in `SKILL.md`. The underlying principles are language-agnostic.\n",
    );
  });

  it("records a miss when a rewrite target is gone", () => {
    const raw = `---
name: blast-radius
description: "Find what a change could break."
---

# Blast radius

Find what a change breaks.

No companion line here.
`;
    const out = adaptFile(skill("blast-radius"), "SKILL.md", raw);
    expect(out.ok).toBe(true);
    expect(out.misses).toContain("blast-radius.how-why");
  });

  it("ports a principle skill slash-only and rewrites principle refs", () => {
    const raw = `---
name: principle-attack-the-premise
description: "Apply when two or more fixes that share one premise have failed the same gate."
disable-model-invocation: true
---

# Attack the Premise

When two or more fixes that share one premise have failed the same gate, suspect the premise, not the fixes.

Make the check rerunnable per [Build the Lever](../principle-build-the-lever/SKILL.md).
The sequencing complement to the **prove-it-works** principle skill.
`;
    const out = adaptFile(
      { name: "principle-attack-the-premise", files: ["SKILL.md"], slash: true },
      "SKILL.md",
      raw,
    );
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("Use for /principle-attack-the-premise.");
    expect(out.text).toContain("Slash `/principle-attack-the-premise` only. Not a session flag.");
    expect(out.text).toContain("`/principle-build-the-lever`");
    expect(out.text).toContain("`/principle-prove-it-works`");
    expect(out.text).not.toContain("disable-model-invocation");
    expect(out.text).not.toContain("../principle-build-the-lever/SKILL.md");
    expect(out.text).not.toContain("**prove-it-works** principle skill");
  });

  it("inlines explain-the-number benchmark-checklist", () => {
    const raw = `---
name: principle-explain-the-number
description: "Apply before you trust, report, or act on a number you measured."
disable-model-invocation: true
---

# Explain the Number

Name the limiter.

For a performance number, run the full procedure with the [benchmark-checklist](../benchmark-checklist/SKILL.md) skill. For an eval result, ask the same of the trials.

Distinct from [Prove It Works](../principle-prove-it-works/SKILL.md), which checks that an output is real.
`;
    const out = adaptFile(
      { name: "principle-explain-the-number", files: ["SKILL.md"], slash: true },
      "SKILL.md",
      raw,
    );
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("name the limiter");
    expect(out.text).toContain("check tuning");
    expect(out.text).toContain("count errors");
    expect(out.text).toContain("repeat");
    expect(out.text).toContain("relevance");
    expect(out.text).toContain("work happened");
    expect(out.text).toContain("`/principle-prove-it-works`");
    expect(out.text).not.toContain("benchmark-checklist");
  });

  it("drops prove-it-works show-me-your-work skill", () => {
    const raw = `---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring done."
disable-model-invocation: true
---

# Prove It Works

Verify every task output by checking the real thing directly.

Keep the artifact visible for the human. Commit it only for large or complex work where the trail has to be auditable later, like a big port or migration (the **show-me-your-work** skill).
`;
    const out = adaptFile(
      { name: "principle-prove-it-works", files: ["SKILL.md"], slash: true },
      "SKILL.md",
      raw,
    );
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("Keep the artifact visible for the human.");
    expect(out.text).not.toContain("show-me-your-work");
  });

  it("rewrites build-the-lever and guard-the-context-window subagent wording", () => {
    const lever = adaptFile(
      { name: "principle-build-the-lever", files: ["SKILL.md"], slash: true },
      "SKILL.md",
      `---
name: principle-build-the-lever
description: "Apply to any non-trivial work. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand."
disable-model-invocation: true
---

# Build the Lever

When the work isn't trivial, build the tool that does it instead of doing it by hand.

- When you fan work out to subagents, write the lever as a skill they all read: the recipe, the verification contract, and the do-not-touch fences in one artifact. Keep it outside the delegates' write scope so they can't quietly edit the contract.
`,
    );
    expect(lever.ok).toBe(true);
    expect(lever.misses).toEqual([]);
    expect(lever.text).toMatch(/later turns/);
    expect(lever.text).toMatch(/child runs/);
    expect(lever.text.toLowerCase()).not.toContain("subagent");

    const guard = adaptFile(
      { name: "principle-guard-the-context-window", files: ["SKILL.md"], slash: true },
      "SKILL.md",
      `---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
disable-model-invocation: true
---

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.
`,
    );
    expect(guard.ok).toBe(true);
    expect(guard.misses).toEqual([]);
    expect(guard.text).toContain("grunt-job");
    expect(guard.text).toContain(".tmp/grunt/");
    expect(guard.text.toLowerCase()).not.toContain("subagent");
  });

  it("adapts never-block-on-the-human to grunt plan-first", () => {
    const raw = `---
name: principle-never-block-on-the-human
description: "Apply when tempted to ask 'should I do X?' on reversible work."
disable-model-invocation: true
---

# Never Block on the Human

The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, proceed, and let the human course-correct after the fact. Since code changes are reversible and reviewable, a wrong decision usually costs less than blocking.

- Proceed, then present. Do the work, show the result. Don't ask "should I do X?" Do X, explain why.
- Irreversible actions (force-push, delete production data, send external messages) still require confirmation.
`;
    const out = adaptFile(
      { name: "principle-never-block-on-the-human", files: ["SKILL.md"], slash: true },
      "SKILL.md",
      raw,
    );
    expect(out.ok).toBe(true);
    expect(out.misses).toEqual([]);
    expect(out.text).toContain("plan approval");
    expect(out.text).toContain("real blockers");
    expect(out.text).toContain("irreversible");
    expect(out.text).toContain("Don't ask preference on reversible execution");
    expect(out.text).toContain("already that approval");
  });
});

const PRINCIPLE_NAMES = [
  "principle-attack-the-premise",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space",
  "principle-experience-first",
  "principle-explain-the-number",
  "principle-fix-root-causes",
  "principle-foundational-thinking",
  "principle-guard-the-context-window",
  "principle-laziness-protocol",
  "principle-make-operations-idempotent",
  "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load",
  "principle-model-the-domain",
  "principle-never-block-on-the-human",
  "principle-outcome-oriented-execution",
  "principle-prove-it-works",
  "principle-redesign-from-first-principles",
  "principle-separate-before-serializing-shared-state",
  "principle-sequence-verifiable-units",
  "principle-subtract-before-you-add",
  "principle-test-behavior-not-implementation",
  "principle-type-system-discipline",
];

describe("PSTACK_SKILLS principles", () => {
  it("lists all 24 principle skills as slash-only SKILL.md", () => {
    const principles = PSTACK_SKILLS.filter((s) => s.name.startsWith("principle-"));
    expect(principles.map((s) => s.name)).toEqual(PRINCIPLE_NAMES);
    for (const s of principles) {
      expect(s).toEqual({ name: s.name, files: ["SKILL.md"], slash: true });
    }
  });
});

describe("syncPstackSkills", () => {
  it("writes adapted files and skips generate on --no-generate", async () => {
    const root = tmp("pstack-sync-");
    const files = new Map([
      [
        "https://raw.githubusercontent.com/backnotprop/pstack/main/skills/bro/SKILL.md",
        `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.
`,
      ],
    ]);
    let generated = 0;
    const chunks: string[] = [];
    const result = await syncPstackSkills({
      workspaceRoot: root,
      argv: ["--skill", "bro", "--no-generate"],
      fetchImpl: async (url: string) => {
        const body = files.get(String(url));
        if (!body) return { ok: false, status: 404, text: async () => "" };
        return { ok: true, status: 200, text: async () => body };
      },
      generateFn: () => {
        generated += 1;
      },
      stdout: { write: (s: string) => chunks.push(s) },
      stderr: { write: () => true },
    });
    expect(result.ok).toBe(true);
    expect(generated).toBe(0);
    expect(chunks.join("")).toContain("write bro/SKILL.md");
    expect(fs.readFileSync(path.join(root, SKILLS_REL, "bro", "SKILL.md"), "utf8")).toContain(
      "Slash `/bro` only.",
    );
  });

  it("--check reports drift without writing", async () => {
    const root = tmp("pstack-check-");
    const dest = path.join(root, SKILLS_REL, "bro");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "SKILL.md"), "stale\n");
    const result = await syncPstackSkills({
      workspaceRoot: root,
      argv: ["--skill", "bro", "--check"],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => `---
name: bro
description: Restate the last message in plain human language, with no jargon.
---

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.
`,
      }),
      generateFn: () => {
        throw new Error("generate should not run");
      },
      stdout: { write: () => true },
      stderr: { write: () => true },
    });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("stale\n");
  });
});
