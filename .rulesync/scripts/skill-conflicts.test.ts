import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSkillContentConflicts,
  formatSkillConflictWarn,
  listSkillDirNames,
} from "./skill-conflicts.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeSkill(root: string, name: string, body: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
}

describe("listSkillDirNames", () => {
  it("lists dirs with SKILL.md; skips missing/dot", () => {
    const root = tmp("sk-list-");
    writeSkill(root, "parent", "a");
    writeSkill(root, "solo", "b");
    fs.mkdirSync(path.join(root, "empty"));
    fs.mkdirSync(path.join(root, ".hidden"));
    writeSkill(path.join(root, ".hidden"), "x", "no");
    expect(listSkillDirNames(root)).toEqual(["parent", "solo"]);
    expect(listSkillDirNames(path.join(root, "missing"))).toEqual([]);
  });
});

describe("findSkillContentConflicts", () => {
  it("empty when packaged missing or identical", () => {
    const ws = tmp("sk-ws-");
    const pkg = tmp("sk-pkg-");
    writeSkill(ws, "parent", "same\n");
    writeSkill(pkg, "parent", "same\n");
    expect(findSkillContentConflicts({ workspaceSkillsDir: ws, packagedSkillsDir: pkg })).toEqual(
      [],
    );
    expect(
      findSkillContentConflicts({
        workspaceSkillsDir: ws,
        packagedSkillsDir: path.join(pkg, "nope"),
      }),
    ).toEqual([]);
    expect(findSkillContentConflicts({})).toEqual([]);
  });

  it("reports name when SKILL.md bytes differ; skips workspace-only", () => {
    const ws = tmp("sk-ws-diff-");
    const pkg = tmp("sk-pkg-diff-");
    writeSkill(ws, "parent", "custom\n");
    writeSkill(pkg, "parent", "grunt\n");
    writeSkill(ws, "extra", "keep\n");
    writeSkill(pkg, "solo", "only-pkg\n");
    writeSkill(ws, "solo", "only-pkg\n");
    const hits = findSkillContentConflicts({
      workspaceSkillsDir: ws,
      packagedSkillsDir: pkg,
    });
    expect(hits.map((h) => h.name)).toEqual(["parent"]);
    expect(hits[0].workspacePath).toContain(`${path.sep}parent${path.sep}SKILL.md`);
  });
});

describe("formatSkillConflictWarn", () => {
  it("names skill and overwrite rule", () => {
    expect(formatSkillConflictWarn("parent")).toMatch(/parent/);
    expect(formatSkillConflictWarn("parent")).toMatch(/re-init overwrites/);
  });
});
