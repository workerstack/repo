import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { MARK, bunRepo, cli, git, marker, scratch, write, wt } from "./__fixtures__/worktree-repo.ts";

/** The Windows command that finds an executable on PATH. */
const WHERE = "where";

const tmp = scratch();
afterEach(() => tmp.cleanup());

function installFailed(dir: string) {
  return `could not install dependencies in ${dir}: run bun install --frozen-lockfile there`;
}

it("runs bun install --frozen-lockfile in a new worktree only, keeping stdout to the path", () => {
  const r = bunRepo(tmp.repo(), MARK);
  expect(marker(r)).toBe(false);
  const first = cli(r, ["add", "dep"]);
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toBe(`${wt(r, "dep")}\n`);
  expect(first.stderr).not.toContain("could not install");
  expect(marker(wt(r, "dep"))).toBe(true);
  fs.rmSync(path.join(wt(r, "dep"), "installed.marker"));
  const again = cli(r, ["add", "dep"]);
  expect(again.stdout).toBe(`${wt(r, "dep")}\n`);
  expect(marker(wt(r, "dep"))).toBe(false);
  expect(marker(r)).toBe(false);
});

it("also tries the install for a legacy bun.lockb", () => {
  const r = bunRepo(tmp.repo(), MARK);
  git(r, "rm", "-qf", "bun.lock");
  write(path.join(r, "bun.lockb"), "not a real binary lockfile");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "legacy");
  const made = cli(r, ["add", "old"]);
  expect(made.status, made.stderr).toBe(0);
  expect(made.stdout).toBe(`${wt(r, "old")}\n`);
  expect(made.stderr).toContain(installFailed(wt(r, "old")));
});

it("skips the install without a lockfile", () => {
  const r = tmp.repo();
  write(path.join(r, "package.json"), `${JSON.stringify({ name: "f", scripts: { postinstall: MARK } })}\n`);
  git(r, "add", "-A");
  git(r, "commit", "-qm", "pkg");
  const made = cli(r, ["add", "bare"]);
  expect(made.status, made.stderr).toBe(0);
  expect(made.stdout).toBe(`${wt(r, "bare")}\n`);
  expect(marker(wt(r, "bare"))).toBe(false);
});

it("reports a failed install in one stderr line and still prints the path", () => {
  const r = bunRepo(tmp.repo(), "exit 1");
  const made = cli(r, ["add", "bad"]);
  expect(made.status).toBe(0);
  expect(made.stdout).toBe(`${wt(r, "bad")}\n`);
  const lines = made.stderr.split("\n").filter((l) => l.includes("could not install"));
  expect(lines).toStrictEqual([installFailed(wt(r, "bad"))]);
});

/** A PATH with git and no bun: a lone git link on posix; git's own cmd dir on win32 (git.exe needs its install). */
function gitOnlyPath(): string {
  if (process.platform === "win32")
    return path.dirname(execFileSync(WHERE, ["git"], { encoding: "utf8" }).split(/\r?\n/)[0] ?? "");
  const bin = tmp.dir("wt-bin-");
  fs.symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), path.join(bin, "git"));
  return bin;
}

it("reports a missing bun the same way", () => {
  const r = bunRepo(tmp.repo(), MARK);
  const made = cli(r, ["add", "nobun"], { env: { PATH: gitOnlyPath() } });
  expect(made.status, made.stderr).toBe(0);
  expect(made.stdout).toBe(`${wt(r, "nobun")}\n`);
  expect(made.stderr).toContain(installFailed(wt(r, "nobun")));
  expect(marker(wt(r, "nobun"))).toBe(false);
});

it("keeps the WorktreeCreate hook's stdout to the path", () => {
  const r = bunRepo(tmp.repo(), MARK);
  const made = cli(r, ["hook"], { input: JSON.stringify({ cwd: r, hook_event_name: "WorktreeCreate", name: "hk" }) });
  expect(made.status, made.stderr).toBe(0);
  expect(made.stdout).toBe(`${wt(r, "hk")}\n`);
  expect(marker(wt(r, "hk"))).toBe(true);
});
