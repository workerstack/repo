import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { plantProgram } from "../__fixtures__/stub-bin.ts";
import { repoEnv } from "../repo-env.ts";
import { commitIn, scratch, wt } from "./__fixtures__/worktree-repo.ts";
import { addWorktree, finishWorktree } from "./worktree-lifecycle.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

/** The git that PATH finds now, before a stub goes in front of it. */
function realGit(): string {
  const name = process.platform === "win32" ? "git.exe" : "git";

  const found = (repoEnv.process.PATH ?? "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, name))
    .find((file) => fs.existsSync(file));

  if (found === undefined) throw new Error("no git on PATH");

  return found;
}

/**
 * Puts a git first on PATH that runs the real one and, after a `worktree remove` that exits 0, leaves a directory link
 * to `target` at `.agents/skills/commit` in the removed dir, as git on win32 leaves the junctions sync made.
 */
function gitLeavingLinks(target: string): void {
  const bin = tmp.dir("wt-bin-");

  const js = [
    'const { spawnSync } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    `const r = spawnSync(${JSON.stringify(realGit())}, args, { stdio: "inherit" });`,
    'if (r.status === 0 && args[0] === "worktree" && args[1] === "remove") {',
    '  const link = path.join(args[args.length - 1], ".agents", "skills", "commit");',
    "  fs.mkdirSync(path.dirname(link), { recursive: true });",
    `  fs.symlinkSync(${JSON.stringify(target)}, link, "junction");`,
    "}",
    "process.exit(r.status ?? 1);",
  ].join("\n");

  plantProgram(bin, "git", js);
  vi.stubEnv("PATH", `${bin}${path.delimiter}${repoEnv.process.PATH ?? ""}`);
}

it("removes what git worktree remove left in the worktree dir, without following a link into the install", () => {
  const r = tmp.repo();
  addWorktree(r, "a");
  commitIn(wt(r, "a"), "a.txt");
  const target = path.join(tmp.dir("wt-install-"), "commit");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "SKILL.md"), "# commit\n");
  gitLeavingLinks(target);
  finishWorktree(r, "a");
  expect(fs.existsSync(wt(r, "a"))).toBe(false);
  expect(fs.readFileSync(path.join(target, "SKILL.md"), "utf8")).toBe("# commit\n");
});
