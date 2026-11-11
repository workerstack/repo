import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanSkillDirs, skillDir } from "./__fixtures__/skill-dirs.ts";
import { findSkillContentConflicts, formatSkillConflictWarn, listSkillDirNames } from "./skill-conflicts.ts";

afterEach(cleanSkillDirs);

function writeSkill(root: string, name: string, body: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
}

it("listSkillDirNames: lists dirs with SKILL.md; skips missing/dot", () => {
  const root = skillDir("sk-list-");
  writeSkill(root, "parent", "a");
  writeSkill(root, "solo", "b");
  fs.mkdirSync(path.join(root, "empty"));
  fs.mkdirSync(path.join(root, ".hidden"));
  writeSkill(path.join(root, ".hidden"), "x", "no");
  expect(listSkillDirNames(root)).toStrictEqual(["parent", "solo"]);
  expect(listSkillDirNames(path.join(root, "missing"))).toStrictEqual([]);
});

it("findSkillContentConflicts: empty when packaged missing or identical", () => {
  const ws = skillDir("sk-ws-");
  const pkg = skillDir("sk-pkg-");
  writeSkill(ws, "parent", "same\n");
  writeSkill(pkg, "parent", "same\n");
  expect(findSkillContentConflicts({ packagedSkillsDir: pkg, workspaceSkillsDir: ws })).toStrictEqual([]);
  expect(
    findSkillContentConflicts({
      packagedSkillsDir: path.join(pkg, "nope"),
      workspaceSkillsDir: ws,
    }),
  ).toStrictEqual([]);
  expect(findSkillContentConflicts({})).toStrictEqual([]);
  expect(findSkillContentConflicts({ packagedSkillsDir: "", workspaceSkillsDir: ws })).toStrictEqual([]);
  expect(findSkillContentConflicts({ packagedSkillsDir: pkg, workspaceSkillsDir: "" })).toStrictEqual([]);
});

it("findSkillContentConflicts: reports name when SKILL.md bytes differ; skips workspace-only", () => {
  const ws = skillDir("sk-ws-diff-");
  const pkg = skillDir("sk-pkg-diff-");
  writeSkill(ws, "parent", "custom\n");
  writeSkill(pkg, "parent", "repo\n");
  writeSkill(ws, "extra", "keep\n");
  writeSkill(pkg, "solo", "only-pkg\n");
  writeSkill(ws, "solo", "only-pkg\n");
  const hits = findSkillContentConflicts({
    packagedSkillsDir: pkg,
    workspaceSkillsDir: ws,
  });
  expect(hits.map((h) => h.name)).toStrictEqual(["parent"]);
  expect(hits[0]?.workspacePath).toContain(`${path.sep}parent${path.sep}SKILL.md`);
});

it("formatSkillConflictWarn: names skill and overwrite rule", () => {
  expect(formatSkillConflictWarn("parent")).toMatch(/parent/);
  expect(formatSkillConflictWarn("parent")).toMatch(/re-init overwrites/);
});
