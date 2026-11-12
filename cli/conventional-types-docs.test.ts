import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { TYPES } from "./conventional.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "agents/skills");
/** A skill's literal type list: `Types: a b c.` */
const TYPES_LINE = /Types: (?<list>[a-z ]+)\./g;
/** The reference's literal type list: "The subject takes the types `a b c`". */
const EXPORTS_LIST = /The subject takes the types `(?<list>[a-z ]+)`/g;

/** Each list `pattern` finds in `rel`, keyed by `rel` and its order in the file. */
function lists(rel: string, pattern: RegExp): [string, string][] {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return [...text.matchAll(pattern)].map((match, index) => [`${rel}#${index}`, match.groups?.["list"] ?? ""]);
}

it("spells every literal type list in TYPES order", () => {
  const skills = fs
    .readdirSync(SKILLS)
    .filter((name) => fs.existsSync(path.join(SKILLS, name, "SKILL.md")))
    .flatMap((name) => lists(`agents/skills/${name}/SKILL.md`, TYPES_LINE));
  const found = [...skills, ...lists("references/exports.md", EXPORTS_LIST)];
  expect(found.some(([rel]) => rel.startsWith("references/exports.md"))).toBe(true);
  expect(found.length).toBeGreaterThan(1);
  const expected = TYPES.join(" ");
  expect(Object.fromEntries(found)).toStrictEqual(Object.fromEntries(found.map(([rel]) => [rel, expected])));
});
