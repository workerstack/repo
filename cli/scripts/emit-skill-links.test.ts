import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BUN, aliasOf } from "../../dev/test-paths";
import { CLAUDE_SKILLS_REL, checkSkillLinks, emitSkillLinks, planSkillLinks } from "./emit-skill-links.ts";
import { STOCK_SKILLS_REL } from "./skill-conflicts.ts";
import { canonicalPath } from "./workspace-root.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "emit-skill-links.ts");

const cleanup: string[] = [];
afterEach(() => {
  for (const p of cleanup.splice(0)) fs.rmSync(p, { recursive: true, force: true });
});

function tmpRoot() {
  const dir = canonicalPath(fs.mkdtempSync(path.join(os.tmpdir(), "skill-links-")));
  cleanup.push(dir);
  return dir;
}

function addSkill(root: string, name: string, body = `---\nname: ${name}\n---\n`) {
  const dir = path.join(root, STOCK_SKILLS_REL, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
}

function linkPath(root: string, name: string) {
  return path.join(root, CLAUDE_SKILLS_REL, name);
}

function runCli(root: string, ...args: string[]) {
  return spawnSync(BUN, [script, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
}

describe("emitSkillLinks", () => {
  it("links every skill that has a SKILL.md and skips dot dirs and dirs without one", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    addSkill(root, "beta");
    fs.mkdirSync(path.join(root, STOCK_SKILLS_REL, "no-skill-md"), { recursive: true });
    fs.mkdirSync(path.join(root, STOCK_SKILLS_REL, ".hidden"), { recursive: true });
    expect(emitSkillLinks(root)).toEqual({ linked: 2, replaced: 0, pruned: 0 });
    for (const name of ["alpha", "beta"]) {
      expect(fs.lstatSync(linkPath(root, name)).isSymbolicLink()).toBe(true);
      expect(canonicalPath(linkPath(root, name))).toBe(canonicalPath(path.join(root, STOCK_SKILLS_REL, name)));
      expect(fs.readFileSync(path.join(linkPath(root, name), "SKILL.md"), "utf8")).toContain(name);
    }
    expect(fs.readdirSync(path.join(root, CLAUDE_SKILLS_REL)).sort()).toEqual(["alpha", "beta"]);
    if (process.platform !== "win32") {
      expect(fs.readlinkSync(linkPath(root, "alpha"))).toBe("../../agents/skills/alpha");
    }
  });

  it("creates nothing when there are no skills", () => {
    const root = tmpRoot();
    expect(emitSkillLinks(root)).toEqual({ linked: 0, replaced: 0, pruned: 0 });
    expect(fs.existsSync(path.join(root, CLAUDE_SKILLS_REL))).toBe(false);
  });

  it("a second run changes nothing and replaces and prunes 0", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    addSkill(root, "beta");
    emitSkillLinks(root);
    const before = fs
      .readdirSync(path.join(root, CLAUDE_SKILLS_REL))
      .map((n) => [n, fs.lstatSync(linkPath(root, n)).ino]);
    expect(emitSkillLinks(root)).toEqual({ linked: 2, replaced: 0, pruned: 0 });
    const after = fs
      .readdirSync(path.join(root, CLAUDE_SKILLS_REL))
      .map((n) => [n, fs.lstatSync(linkPath(root, n)).ino]);
    expect(after).toEqual(before);
  });

  it("replaces a real dir that has a source name and reports it", () => {
    const root = tmpRoot();
    addSkill(root, "alpha", "from source\n");
    fs.mkdirSync(linkPath(root, "alpha"), { recursive: true });
    fs.writeFileSync(path.join(linkPath(root, "alpha"), "SKILL.md"), "stale copy\n");
    const logs: string[] = [];
    expect(emitSkillLinks(root, { log: (m: string) => logs.push(m) })).toEqual({
      linked: 1,
      replaced: 1,
      pruned: 0,
    });
    expect(logs).toEqual(["replaced .claude/skills/alpha (real dir) with link"]);
    expect(fs.lstatSync(linkPath(root, "alpha")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(linkPath(root, "alpha"), "SKILL.md"), "utf8")).toBe("from source\n");
    expect(emitSkillLinks(root)).toEqual({ linked: 1, replaced: 0, pruned: 0 });
  });

  it("leaves a real dir with another name alone", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    const own = linkPath(root, "consumer-own");
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, "SKILL.md"), "mine\n");
    expect(emitSkillLinks(root)).toEqual({ linked: 1, replaced: 0, pruned: 0 });
    expect(fs.lstatSync(own).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(own, "SKILL.md"), "utf8")).toBe("mine\n");
    expect(checkSkillLinks(root)).toEqual([]);
  });

  it("re-points a link with the wrong target", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    addSkill(root, "beta");
    fs.mkdirSync(path.join(root, CLAUDE_SKILLS_REL), { recursive: true });
    fs.symlinkSync("../../agents/skills/beta", linkPath(root, "alpha"), "junction");
    expect(emitSkillLinks(root)).toEqual({ linked: 2, replaced: 0, pruned: 0 });
    expect(canonicalPath(linkPath(root, "alpha"))).toBe(canonicalPath(path.join(root, STOCK_SKILLS_REL, "alpha")));
  });

  it("prunes a dangling link into the skills source and leaves a link elsewhere", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    fs.mkdirSync(path.join(root, CLAUDE_SKILLS_REL), { recursive: true });
    fs.symlinkSync("../../agents/skills/gone", linkPath(root, "gone"), "junction");
    fs.symlinkSync("../../elsewhere/nope", linkPath(root, "elsewhere"), "junction");
    const logs: string[] = [];
    expect(emitSkillLinks(root, { log: (m: string) => logs.push(m) })).toEqual({
      linked: 1,
      replaced: 0,
      pruned: 1,
    });
    expect(logs).toEqual(["pruned .claude/skills/gone (dangling link)"]);
    expect(fs.existsSync(linkPath(root, "gone"))).toBe(false);
    expect(() => fs.lstatSync(linkPath(root, "gone"))).toThrow();
    expect(fs.lstatSync(linkPath(root, "elsewhere")).isSymbolicLink()).toBe(true);
  });

  it("keeps a live link into the skills source whose name has no SKILL.md", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    fs.mkdirSync(path.join(root, STOCK_SKILLS_REL, "bare"), { recursive: true });
    fs.mkdirSync(path.join(root, CLAUDE_SKILLS_REL), { recursive: true });
    fs.symlinkSync("../../agents/skills/bare", linkPath(root, "bare"), "junction");
    expect(emitSkillLinks(root)).toEqual({ linked: 1, replaced: 0, pruned: 0 });
    expect(fs.lstatSync(linkPath(root, "bare")).isSymbolicLink()).toBe(true);
  });

  it("planSkillLinks names each action without touching disk", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    addSkill(root, "beta");
    fs.mkdirSync(linkPath(root, "beta"), { recursive: true });
    fs.symlinkSync("../../agents/skills/gone", linkPath(root, "gone"), "junction");
    expect(planSkillLinks(root)).toEqual([
      { kind: "link", name: "alpha" },
      { kind: "replace", name: "beta" },
      { kind: "prune", name: "gone" },
    ]);
    expect(fs.lstatSync(linkPath(root, "beta")).isDirectory()).toBe(true);
    expect(fs.existsSync(linkPath(root, "alpha"))).toBe(false);
  });
});

describe("checkSkillLinks", () => {
  it("passes on a generated tree and compares targets by canonical path through an alias", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    const alias = aliasOf(root);
    cleanup.push(alias);
    fs.mkdirSync(path.join(root, CLAUDE_SKILLS_REL), { recursive: true });
    // Absolute target spelled through the alias: same directory, different string.
    fs.symlinkSync(path.join(alias, STOCK_SKILLS_REL, "alpha"), linkPath(root, "alpha"), "junction");
    expect(checkSkillLinks(root)).toEqual([]);
    expect(checkSkillLinks(alias)).toEqual([]);
    expect(emitSkillLinks(alias)).toEqual({ linked: 1, replaced: 0, pruned: 0 });
  });

  it("lists a missing, wrong-target and real-dir-shadowing entry", () => {
    const root = tmpRoot();
    for (const n of ["commit", "missing-one", "wrong-one", "shadowed"]) addSkill(root, n);
    fs.mkdirSync(path.join(root, CLAUDE_SKILLS_REL), { recursive: true });
    // An absolute target, as a win32 junction holds, still reads back relative to the link.
    fs.symlinkSync(path.join(root, STOCK_SKILLS_REL, "commit"), linkPath(root, "wrong-one"), "junction");
    fs.symlinkSync("../../agents/skills/commit", linkPath(root, "commit"), "junction");
    fs.cpSync(path.join(root, STOCK_SKILLS_REL, "shadowed"), linkPath(root, "shadowed"), { recursive: true });
    const fix = "run bun repo sync";
    expect(checkSkillLinks(root)).toEqual([
      `skill-links FAIL missing .claude/skills/missing-one -> ../../agents/skills/missing-one: ${fix}`,
      `skill-links FAIL real dir .claude/skills/shadowed shadows agents/skills/shadowed: ${fix}`,
      `skill-links FAIL wrong target .claude/skills/wrong-one -> ../../agents/skills/commit: ${fix}`,
    ]);
  });

  it("fails on a dangling link into the skills source and ignores one elsewhere", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    emitSkillLinks(root);
    fs.symlinkSync("../../agents/skills/gone", linkPath(root, "gone"), "junction");
    fs.symlinkSync("../../elsewhere/nope", linkPath(root, "elsewhere"), "junction");
    expect(checkSkillLinks(root)).toEqual(["skill-links FAIL dangling .claude/skills/gone: run bun repo sync"]);
  });

  it("ignores a consumer real dir with no source and an empty tree", () => {
    const root = tmpRoot();
    expect(checkSkillLinks(root)).toEqual([]);
    fs.mkdirSync(linkPath(root, "own"), { recursive: true });
    expect(checkSkillLinks(root)).toEqual([]);
  });
});

describe("CLI", () => {
  it("generate prints the counts, then check prints ok", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    addSkill(root, "beta");
    fs.mkdirSync(linkPath(root, "beta"), { recursive: true });
    const first = runCli(root);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(
      "replaced .claude/skills/beta (real dir) with link\nskill-links: 2 linked, 1 replaced, 0 pruned\n",
    );
    expect(runCli(root).stdout).toBe("skill-links: 2 linked, 0 replaced, 0 pruned\n");
    const check = runCli(root, "--check");
    expect(check.status).toBe(0);
    expect(check.stdout).toBe("skill-links: ok\n");
  });

  it("check exits 1 and prints each FAIL line", () => {
    const root = tmpRoot();
    addSkill(root, "alpha");
    const r = runCli(root, "--check");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(
      "skill-links FAIL missing .claude/skills/alpha -> ../../agents/skills/alpha: run bun repo sync\n",
    );
  });

  it("rejects an unknown flag", () => {
    const root = tmpRoot();
    const r = runCli(root, "--wat");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("unknown flag: --wat\n");
  });
});

describe("planSkillLinks skillsRoot", () => {
  it("lists skills from skillsRoot and plans links under root", () => {
    const stock = tmpRoot();
    const out = tmpRoot();
    addSkill(stock, "alpha");
    expect(planSkillLinks(out)).toEqual([]);
    expect(planSkillLinks(out, { skillsRoot: stock })).toEqual([{ kind: "link", name: "alpha" }]);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it("prunes a link dangling into skillsRoot", () => {
    const stock = tmpRoot();
    const out = tmpRoot();
    fs.mkdirSync(path.join(out, CLAUDE_SKILLS_REL), { recursive: true });
    fs.symlinkSync(path.join(stock, STOCK_SKILLS_REL, "gone"), linkPath(out, "gone"));
    fs.mkdirSync(path.join(stock, STOCK_SKILLS_REL), { recursive: true });
    expect(planSkillLinks(out, { skillsRoot: stock })).toEqual([{ kind: "prune", name: "gone" }]);
  });
});
