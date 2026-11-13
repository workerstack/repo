import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadEval } from "../../cli/eval/load.ts";
import { cases } from "./cases.ts";
import { routesTo } from "./routes-to.ts";
import { skillSystem } from "./skill-system.ts";

const SKILLS = join(import.meta.dirname, "..", "..", "agents", "skills");
const FIXTURES = join(import.meta.dirname, "__fixtures__");
const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = /^(transcript \d{4}-\d{2}-\d{2}|control of [\w-]+)$/;
const CONTROL_SUFFIX = /-control$/;

const FOLDED = [
  "Apply when you write, change, or keep a test.",
  "Assert what the code's users can observe, so that the test fails when that behavior breaks",
  "and keeps passing when only the internals change.",
  "Use for /principle-test-behavior-not-implementation.",
].join(" ");

const skills = new Set(readdirSync(SKILLS));
const routed = cases.filter((entry) => entry.control !== true);
const controls = cases.filter((entry) => entry.control === true);
const byId = new Map(cases.map((entry) => [entry.id, entry]));

/** What the paired case of `id` expects: the control of a routed case, or the routed case of a control. */
function byOpposite(id: string): string {
  const pairId = CONTROL_SUFFIX.test(id) ? id.replace(CONTROL_SUFFIX, "") : `${id}-control`;
  const pair = byId.get(pairId);

  if (pair === undefined) throw new Error(`no pair for ${id}`);

  return pair.expect;
}

describe("skillSystem", () => {
  const lines = skillSystem(SKILLS).split("\n");

  it("lists one line per skill folder, sorted by name", () => {
    const listed = lines.filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(": ")));

    expect(listed).toStrictEqual([...skills].toSorted());
  });

  it("puts a folded multi-line description whole on one line", () => {
    expect(lines).toContain(`- principle-test-behavior-not-implementation: ${FOLDED}`);
  });

  it("throws an error naming the file of a skill with no description", () => {
    expect(() => skillSystem(FIXTURES)).toThrow(/no-description[/\\]SKILL\.md/);
  });
});

describe("routesTo", () => {
  const grade = routesTo("commit");

  it.each(["commit", "/commit", "`commit`", "commit.", "Commit\n"])("accepts %j", (answer) => {
    expect(grade(answer)).toBe(true);
  });

  it.each(["commit-push", "none", "I would use commit"])("rejects %j", (answer) => {
    expect(grade(answer)).toBe(false);
  });
});

it("has 12 routed cases and 12 controls", () => {
  expect(routed).toHaveLength(12);
  expect(controls).toHaveLength(12);
});

describe("skill routing cases", () => {
  it.each(cases.map((entry) => [entry.id, entry.source] as const))(
    "%s names a transcript or its case",
    (_id, source) => {
      expect(source).toMatch(SOURCE);
    },
  );

  it.each(cases.map((entry) => [entry.id, entry.expect] as const))(
    "%s expects a skill folder or none",
    (_id, expected) => {
      expect(expected === "none" || skills.has(expected)).toBe(true);
    },
  );

  it.each(routed.map((entry) => [entry.id, entry] as const))(
    "%s has one control that expects another answer",
    (id, entry) => {
      const control = byId.get(`${id}-control`);

      expect(control?.control).toBe(true);
      expect(control?.source).toBe(`control of ${id}`);
      expect(control?.expect).not.toBe(entry.expect);
      expect(cases.filter((other) => other.source === `control of ${id}`)).toHaveLength(1);
    },
  );

  it("gives every control a routed case", () => {
    for (const entry of controls) expect(byId.get(entry.id.replace(CONTROL_SUFFIX, ""))?.control).not.toBe(true);
  });
});

describe("skill routing eval", () => {
  it("loads through the runner with the haiku model and its grader accepts only each expected name", async () => {
    const loaded = await loadEval(ROOT, "skill-routing");

    if (!loaded.ok) throw new Error(loaded.message);

    expect(loaded.spec.model).toBe("claude-haiku-5-5");
    expect(loaded.spec.cases.map((entry) => entry.id)).toStrictEqual(cases.map((entry) => entry.id));

    for (const [index, entry] of cases.entries()) {
      const pass = loaded.spec.cases[index]?.pass;

      expect(pass?.(entry.expect), entry.id).toBe(true);
      expect(pass?.(byOpposite(entry.id)), `${entry.id} rejects the paired answer`).toBe(false);
    }
  });
});
