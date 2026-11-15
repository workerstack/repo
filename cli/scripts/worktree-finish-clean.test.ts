import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { IGNORE_LINES } from "./__fixtures__/clean-kit.ts";
import { cli, commitIn, mainIn, scratch, short, write, wt } from "./__fixtures__/worktree-repo.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const DAY = 24 * 3600_000;

/** A repo that ignores the `.repo` dirs, with worktree `a` holding one commit. */
function repoWithWork(): string {
  const r = tmp.repo();
  commitIn(r, ".gitignore", `.env\n.worktrees/\n${IGNORE_LINES}`);
  cli(r, ["add", "a"]);
  commitIn(wt(r, "a"), "a.txt");

  return r;
}

/** Writes `rel` under `r`, last touched `ms` before now. */
function plant(r: string, rel: string, ms: number): string {
  const file = path.join(r, rel);
  write(file, "x");
  const t = new Date(Date.now() - ms);
  fs.utimesSync(file, t, t);

  return file;
}

function merged(r: string): string {
  return (
    `merged wt/a into main at ${short(r, "main")} and removed ${wt(r, "a")}; ` +
    `your shell may still be in it: cd ${r}`
  );
}

it("finish sweeps stale .repo state in the root and reports it", () => {
  const r = repoWithWork();
  const old = plant(r, ".repo/scratch/old.log", 3 * DAY);
  const fresh = plant(r, ".repo/scratch/fresh.log", DAY);
  const out = mainIn(r, ["finish", "a"]);
  expect(out.code, out.stderr).toBe(0);
  expect(out.stdout).toBe(`${merged(r)}\ncleaned .repo: removed 1 file (1 B)\n`);
  expect(fs.existsSync(old)).toBe(false);
  expect(fs.existsSync(fresh)).toBe(true);
});

it("finish prints only the merged line when nothing is stale", () => {
  const r = repoWithWork();
  plant(r, ".repo/scratch/fresh.log", DAY);
  const out = mainIn(r, ["finish", "a"]);
  expect(out.code, out.stderr).toBe(0);
  expect(out.stdout).toBe(`${merged(r)}\n`);
});

it("finish names a path the sweep could not remove on stderr and still exits 0", () => {
  const r = repoWithWork();
  const old = plant(r, ".repo/scratch/old.log", 3 * DAY);
  const rm = fs.rmSync;
  vi.spyOn(fs, "rmSync").mockImplementation((p, opts) => {
    if (String(p) === old) throw Object.assign(new Error("denied"), { code: "EACCES" });
    rm(p, opts);
  });
  const out = mainIn(r, ["finish", "a"]);
  expect(out.code, out.stderr).toBe(0);
  expect(out.stdout).toBe(`${merged(r)}\n`);
  expect(out.stderr).toContain("skipped .repo/scratch/old.log: EACCES\n");
  expect(fs.existsSync(old)).toBe(true);
});

it("finish still exits 0 and warns when the sweep throws", () => {
  const r = repoWithWork();
  plant(r, ".repo/scratch/old.log", 3 * DAY);
  // A file where the board dir belongs makes the live-session read throw.
  const home = path.join(r, ".worktrees/board-home");
  write(path.join(home, ".workerstack/board"), "");
  vi.stubEnv("REPO_BOARD_HOME", home);
  const out = mainIn(r, ["finish", "a"]);
  expect(out.code, out.stderr).toBe(0);
  expect(out.stdout).toBe(`${merged(r)}\n`);
  expect(out.stderr).toContain(`could not clean ${path.join(r, ".repo")}: `);
  expect(out.stderr).toContain("; run bun repo clean there");
  expect(fs.existsSync(path.join(r, ".repo/scratch/old.log"))).toBe(true);
});
