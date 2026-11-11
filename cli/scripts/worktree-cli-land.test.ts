import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  cli,
  commitIn,
  git,
  hasBranch,
  pinOriginHead,
  plantHook,
  raceHook,
  scratch,
  shPath,
  short,
  subjects,
  write,
  wt,
} from "./fixtures/worktree-repo.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

/** A repo on `start` with worktree `name` holding one commit; returns the repo and that commit. */
function oneCommit(name: string, start?: string): { r: string; tip: string } {
  const r = tmp.repo();
  if (start) git(r, "switch", "-q", "-c", start);
  cli(r, ["add", name]);
  commitIn(wt(r, name), `${name}.txt`);
  return { r, tip: git(wt(r, name), "rev-parse", "HEAD") };
}

it("advances the default ref while the main checkout sits on another branch", () => {
  const r = tmp.repo();
  pinOriginHead(r);
  git(r, "switch", "-q", "-c", "other");
  cli(r, ["add", "o"]);
  commitIn(wt(r, "o"), "o.txt");
  const tip = git(wt(r, "o"), "rev-parse", "HEAD");
  const out = cli(r, ["finish", "o"]);
  expect(out.status, out.stderr).toBe(0);
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(git(r, "branch", "--show-current")).toBe("other");
  expect(fs.existsSync(path.join(r, "o.txt"))).toBe(false);
  expect(hasBranch(r, "wt/o")).toBe(false);
  expect(fs.existsSync(wt(r, "o"))).toBe(false);
});

it("lands on main, not on the branch the root sits on, when there is no origin/HEAD", () => {
  const { r, tip } = oneCommit("f", "feature");
  const featureTip = git(r, "rev-parse", "feature");
  const out = cli(r, ["finish", "f"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toContain(`merged wt/f into main at ${short(r, "main")}`);
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(git(r, "rev-parse", "feature")).toBe(featureTip);
  expect(git(r, "branch", "--show-current")).toBe("feature");
  expect(fs.existsSync(path.join(r, "f.txt"))).toBe(false);
});

it("prefers init.defaultBranch, then master, when main does not exist", () => {
  const r = tmp.repo();
  git(r, "branch", "-m", "main", "trunk");
  git(r, "switch", "-q", "-c", "feature");
  git(r, "config", "init.defaultBranch", "trunk");
  cli(r, ["add", "t"]);
  commitIn(wt(r, "t"), "t.txt");
  const tip = git(wt(r, "t"), "rev-parse", "HEAD");
  expect(cli(r, ["finish", "t"]).status).toBe(0);
  expect(git(r, "rev-parse", "trunk")).toBe(tip);
  const m = tmp.repo();
  git(m, "branch", "-m", "main", "master");
  git(m, "switch", "-q", "-c", "feature");
  cli(m, ["add", "m"]);
  commitIn(wt(m, "m"), "m.txt");
  const masterTip = git(wt(m, "m"), "rev-parse", "HEAD");
  expect(cli(m, ["finish", "m"]).status).toBe(0);
  expect(git(m, "rev-parse", "master")).toBe(masterTip);
});

it("falls back to the branch the root sits on when no default branch is named or present", () => {
  const r = tmp.repo();
  git(r, "branch", "-m", "main", "develop");
  cli(r, ["add", "d"]);
  commitIn(wt(r, "d"), "d.txt");
  const tip = git(wt(r, "d"), "rev-parse", "HEAD");
  const out = cli(r, ["finish", "d"]);
  expect(out.status, out.stderr).toBe(0);
  expect(git(r, "rev-parse", "develop")).toBe(tip);
});

it("converges when another session's prune removed the worktree right after the fast-forward", () => {
  const { r, tip } = oneCommit("p");
  plantHook(r, "post-merge", [`git -C '${shPath(r)}' worktree remove --force '${shPath(wt(r, "p"))}'`]);
  const out = cli(r, ["finish", "p"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toContain(`merged wt/p into main at ${short(r, "main")}`);
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(hasBranch(r, "wt/p")).toBe(false);
  expect(git(r, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
});

it("reports git's reason when the main checkout's own changes block the fast-forward", () => {
  const r = tmp.repo();
  cli(r, ["add", "b"]);
  commitIn(wt(r, "b"), "packages/a/index.js", "wt\n");
  write(path.join(r, "packages/a/index.js"), "local\n");
  const before = git(r, "rev-parse", "main");
  const out = cli(r, ["finish", "b"]);
  expect(out.status).toBe(1);
  expect(out.stderr.startsWith(`could not fast-forward main in ${r}: `)).toBe(true);
  expect(out.stderr).toContain("packages/a/index.js");
  expect(out.stderr.trim().split("\n")).toHaveLength(1);
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(fs.readFileSync(path.join(r, "packages/a/index.js"), "utf8")).toBe("local\n");
  expect(fs.existsSync(wt(r, "b"))).toBe(true);
  expect(hasBranch(r, "wt/b")).toBe(true);
});

it("resolves the name from inside the worktree and exits 2 without one in the root", () => {
  const { r } = oneCommit("n");
  const none = cli(r, ["finish"]);
  expect(none.status).toBe(2);
  expect(none.stderr).toBe("run finish inside .worktrees/<name> or pass its name\n");
  expect(fs.existsSync(wt(r, "n"))).toBe(true);
  const inside = cli(path.join(wt(r, "n"), "packages/a"), ["finish"]);
  expect(inside.status, inside.stderr).toBe(0);
  expect(inside.stdout).toBe(
    `merged wt/n into main at ${short(r, "main")} and removed ${wt(r, "n")}; your shell may still be in it: cd ${r}\n`,
  );
  expect(fs.existsSync(wt(r, "n"))).toBe(false);
});

it("retries the rebase once when the default branch moves during it", () => {
  const { r } = oneCommit("race");
  commitIn(r, "m.txt");
  raceHook(r, true);
  const out = cli(r, ["finish", "race"]);
  expect(out.status, out.stderr).toBe(0);
  expect(subjects(r)).toStrictEqual(["race.txt", "raced", "m.txt", "init"]);
  expect(git(r, "rev-list", "--merges", "main")).toBe("");
  expect(hasBranch(r, "wt/race")).toBe(false);
  expect(fs.existsSync(wt(r, "race"))).toBe(false);
});

it("gives up after three tries when the default branch moves every time", () => {
  const { r } = oneCommit("race");
  commitIn(r, "m.txt");
  raceHook(r, false);
  const out = cli(r, ["finish", "race"]);
  expect(out.status).toBe(1);
  expect(out.stderr).toBe("main kept moving while finishing wt/race; run finish again\n");
  expect(subjects(r).filter((s) => s === "raced")).toHaveLength(3);
  expect(subjects(r)).not.toContain("race.txt");
  expect(hasBranch(r, "wt/race")).toBe(true);
  expect(fs.existsSync(wt(r, "race"))).toBe(true);
});
