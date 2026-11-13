import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { loadEval } from "../../cli/eval/load.ts";
import { parseDoc } from "../../cli/sync/agents/frontmatter.ts";
import { cases } from "./cases.ts";
import { rulesSystem } from "./rules-system.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = /^(transcript \d{4}-\d{2}-\d{2}(, context added)?|control of [\w-]+)$/;
const STEPS = ["plan", "worktree", "edit", "answer"];
const FILES = ["agents/rules/overview.md", "references/scope.md", "cli/eval", "cli/sync/agents/frontmatter.ts"];

/** The body of the repo file `rel`, below its frontmatter. */
function body(rel: string): string {
  return parseDoc(rel, readFileSync(join(ROOT, rel), "utf8")).body;
}

const real = cases.filter((one) => one.control !== true);
const pairOf = new Map(real.map((one) => [one.id, cases.find((other) => other.source === `control of ${one.id}`)]));

it("puts the rules and the scope page in the system text and names the four first steps", () => {
  const system = rulesSystem(ROOT);

  expect(system).toContain(`Contents of AGENTS.md:\n\n${body("agents/rules/overview.md")}`);
  expect(system).toContain(`references/scope.md:\n\n${body("references/scope.md")}`);

  for (const step of STEPS) expect(system).toContain(`${step}: `);
});

it("has 4 plan cases, 4 worktree cases and one control each, every source a transcript or its case", () => {
  expect(real.filter((one) => one.expect === "plan")).toHaveLength(4);
  expect(real.filter((one) => one.expect === "worktree")).toHaveLength(4);
  expect(cases).toHaveLength(16);

  for (const one of cases) expect(one.source, one.id).toMatch(SOURCE);
});

const REWRITTEN = [
  {
    control: "we agreed repo eval should run on the session by default. what is the default right now?",
    id: "worktree-make-default",
    input: "we agreed repo eval should run on the session by default. good, just make it the default, should be easy",
    source: "transcript 2026-11-10, context added",
  },
  {
    control: "we moved the eval cache to .repo/tmp/evals. does repo clean still work after the move?",
    id: "worktree-clean-after-move",
    input:
      "we moved the eval cache to .repo/tmp/evals. " +
      "also make sure repo clean is updated to work after the move correctly",
    source: "transcript 2026-11-12, context added",
  },
];

it.each(REWRITTEN)("$id names its target in the message, with a control that shares the opening", (want) => {
  const one = cases.find((other) => other.id === want.id);
  const control = cases.find((other) => other.id === `${want.id}-control`);

  expect(one).toMatchObject({ input: want.input, source: want.source });
  expect(control?.input).toBe(want.control);
});

it.each(real.map((one) => [one.id, one] as const))("%s has a control that expects the next step down", (id, one) => {
  const control = pairOf.get(id);

  expect(control?.control).toBe(true);
  expect(control?.expect).toBe(one.expect === "plan" ? "worktree" : "answer");
  expect(cases.filter((other) => other.source === `control of ${id}`)).toHaveLength(1);
});

it("loads on sonnet at 2 samples with the files it reads, each grader taking its step only, never edit", async () => {
  const loaded = await loadEval(ROOT, "rules-compliance");

  if (!loaded.ok) throw new Error(loaded.message);
  expect(loaded.spec).toMatchObject({ files: FILES, maxTokens: 16, model: "claude-sonnet-5-5", samples: 2 });
  expect(loaded.spec.cases.map((one) => one.id)).toStrictEqual(cases.map((one) => one.id));

  for (const [index, one] of cases.entries()) {
    const pass = loaded.spec.cases[index]?.pass;
    const others = STEPS.filter((step) => step !== one.expect);

    expect(pass?.(one.expect), one.id).toBe(true);

    for (const step of others) expect(pass?.(step), `${one.id} refuses ${step}`).toBe(false);
  }
});
