import { expect, it } from "vitest";

import { adaptFile } from "./sync-pstack-adapt.ts";
import {
  BLAST_MISSING,
  BLAST_UPSTREAM,
  BRO_UPSTREAM,
  CORRECT_UPSTREAM,
  TYPESCRIPT_UPSTREAM,
  UNSLOP_UPSTREAM,
  BRO_BODY,
  adaptOk,
  skill,
} from "./sync-pstack-fixtures.ts";

const PATTERNS_UPSTREAM =
  "# TypeScript patterns\n\nCode examples for each rule in `SKILL.md`. " +
  "The underlying principles are language-agnostic. " +
  "See the **type-system-discipline** and **boundary-discipline** principle skills.\n";

const BRO_LEAD =
  "This reply only: restate the last message in plain human language. Not a mode switch or session flag. " +
  "After this reply, revert to output.md.";

it("adaptFile ports bro", () => {
  const out = adaptOk(skill("bro"), "SKILL.md", BRO_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toStrictEqual([]);
  expect(out.text).toBe(`---
name: bro
description: "Restate the last message in plain human language, with no jargon."
---
${BRO_LEAD}

${BRO_BODY}

Slash \`/bro\` only.
`);
});

it("adaptFile ports unslop slash-only and keeps rules", () => {
  const out = adaptOk(skill("unslop"), "SKILL.md", UNSLOP_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toStrictEqual([]);
  expect(out.text).toContain("Use for /unslop.");
  expect(out.text).toContain("Slash `/unslop` only. Not a session flag.");
  expect(out.text).toContain("7. **AI vocabulary.** Additionally, crucial, delve.");
  expect(out.text).not.toContain("disable-model-invocation");
});

it("adaptFile rewrites blast-radius pstack-only steps", () => {
  const out = adaptOk(skill("blast-radius"), "SKILL.md", BLAST_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toStrictEqual([]);
  expect(out.text).toContain("Use for /blast-radius, 'blast radius of X'");
  expect(out.text).toContain("This is not a walkthrough of what the code does");
  expect(out.text).toContain("`git log` / `git blame`");
  expect(out.text).toContain("second independent pass");
  expect(out.text).toContain("through `/unslop`");
  expect(out.text).not.toContain("`how`");
  expect(out.text).not.toContain("`arena`");
});

it("adaptFile rewrites correct rule table home", () => {
  const out = adaptOk(skill("correct"), "SKILL.md", CORRECT_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toStrictEqual([]);
  expect(out.text).toContain("`AGENTS.md` (SSOT: `agents/rules/overview.md`)");
  expect(out.text).toContain("Slash `/correct` only.");
});

it("adaptFile inlines typescript principles and extra file", () => {
  const ts = skill("typescript-best-practices");
  const out = adaptOk(ts, "SKILL.md", TYPESCRIPT_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toStrictEqual([]);
  expect(out.text).toContain("Make illegal states unrepresentable.");
  expect(out.text).toContain("or for /typescript-best-practices.");
  expect(out.text).not.toContain("paths:");
  expect(out.text).not.toContain("principle skill");
  expect(out.text).toContain("next to this skill.");
  expect(adaptOk(ts, "references/patterns.md", PATTERNS_UPSTREAM).text).toBe(
    "# TypeScript patterns\n\nCode examples for each rule in `SKILL.md`. " +
      "The underlying principles are language-agnostic.\n",
  );
});

it("adaptFile records a miss when a rewrite target is gone", () => {
  const out = adaptOk(skill("blast-radius"), "SKILL.md", BLAST_MISSING);
  expect(out.ok).toBe(true);
  expect(out.misses).toContain("blast-radius.how-why");
});

it("adaptFile names a file with no frontmatter", () => {
  expect(adaptFile(skill("bro"), "SKILL.md", "plain\n")).toStrictEqual({
    error: "missing frontmatter",
    misses: [],
    ok: false,
  });
});
