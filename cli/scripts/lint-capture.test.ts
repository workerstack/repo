import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { captureBun } from "./lint.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

it("captureBun drops GIT_DIR and GIT_INDEX_FILE, so a git run in a temp dir leaves a planted repo unchanged", () => {
  const planted = tempDir("workerstack-capture-git-");
  const other = tempDir("workerstack-capture-other-");
  spawnSync("git", ["init", "-q"], { cwd: planted });
  const gitDir = path.join(planted, ".git");
  const before = fs.readdirSync(gitDir).sort();
  vi.stubEnv("GIT_DIR", gitDir);
  vi.stubEnv("GIT_INDEX_FILE", path.join(gitDir, "index"));
  const script = "Bun.spawnSync(['git', 'init', '-q'], { cwd: process.argv[1] })";
  const run = captureBun(["-e", script, other], os.tmpdir());
  expect(run.code).toBe(0);
  expect(fs.existsSync(path.join(other, ".git"))).toBe(true);
  expect(fs.readdirSync(gitDir).sort()).toStrictEqual(before);
});
