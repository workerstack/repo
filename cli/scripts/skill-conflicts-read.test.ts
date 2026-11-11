import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { findSkillContentConflicts, listSkillDirNames } from "./skill-conflicts.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-read-"));
  dirs.push(dir);
  return dir;
};

it("a skills root that is not a directory is an error, not an empty list", () => {
  const file = path.join(tmp(), "plain");
  fs.writeFileSync(file, "x");
  expect(() => listSkillDirNames(file)).toThrow(/ENOTDIR/);
});

it("a SKILL.md that is a directory does not count as a skill", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "odd", "SKILL.md"), { recursive: true });
  fs.writeFileSync(path.join(root, "loose.md"), "x");
  expect(listSkillDirNames(root)).toStrictEqual([]);
});

it("a packaged skill the workspace cannot read is skipped", () => {
  const ws = tmp();
  const pkg = tmp();
  fs.mkdirSync(path.join(ws, "a", "SKILL.md"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "a"));
  fs.writeFileSync(path.join(pkg, "a", "SKILL.md"), "x");
  expect(findSkillContentConflicts({ packagedSkillsDir: pkg, workspaceSkillsDir: ws })).toStrictEqual([]);
});

it("no dirs given means no conflicts", () => {
  expect(findSkillContentConflicts()).toStrictEqual([]);
});
