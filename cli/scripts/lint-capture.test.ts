import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { captureBun } from "./lint.ts";

const { tempDir } = useTempDirs("workerstack-capture-");

it("captureBun drops GIT_DIR and GIT_INDEX_FILE, so git in a temp dir leaves a planted repo unchanged", async () => {
  const planted = tempDir();
  const other = tempDir();
  spawnSync("git", ["init", "-q"], { cwd: planted });
  const gitDir = path.join(planted, ".git");
  const before = fs.readdirSync(gitDir).toSorted(byCodeUnit);
  vi.stubEnv("GIT_DIR", gitDir);
  vi.stubEnv("GIT_INDEX_FILE", path.join(gitDir, "index"));
  const script = "Bun.spawnSync(['git', 'init', '-q'], { cwd: process.argv[1] })";
  const run = await captureBun(["-e", script, other], os.tmpdir());
  expect(run.code).toBe(0);
  expect(fs.existsSync(path.join(other, ".git"))).toBe(true);
  expect(fs.readdirSync(gitDir).toSorted(byCodeUnit)).toStrictEqual(before);
});

it("captureBun keeps all of a run's output when it exits right after writing, and fails a killed run", async () => {
  const script = 'process.stdout.write("x".repeat(4 * 1024 * 1024)); process.stderr.write("done"); process.exit(3);';
  const run = await captureBun(["-e", script], os.tmpdir());
  expect([run.code, run.stdout.length, run.stderr]).toStrictEqual([3, 4 * 1024 * 1024, "done"]);
  const killed = await captureBun(["-e", "process.kill(process.pid, 'SIGKILL')"], os.tmpdir());
  expect(killed.code).toBe(1);
});
