import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "agents/skills");
const PICKER = "approval picker";
const NO_BLOCK = "On Claude Code outside away, print no block";

it("tells Claude Code to print no approval block in every skill that names the approval picker", () => {
  const named = fs
    .readdirSync(SKILLS)
    .map((name) => path.join(SKILLS, name, "SKILL.md"))
    .filter((file) => fs.existsSync(file))
    .map((file) => [path.relative(ROOT, file), fs.readFileSync(file, "utf8")] as const)
    .filter(([, text]) => text.includes(PICKER));

  expect(named.length).toBeGreaterThan(3);
  expect(Object.fromEntries(named.map(([rel, text]) => [rel, text.includes(NO_BLOCK)]))).toStrictEqual(
    Object.fromEntries(named.map(([rel]) => [rel, true])),
  );
});
