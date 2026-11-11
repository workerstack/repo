import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import { captured, cli, commitIn, git, hasBranch, mainIn, scratch, write, wt } from "./fixtures/worktree-repo.ts";
import { isManaged } from "./worktree-git.ts";
import { main } from "./worktree.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

it("lists every linked worktree with its state", () => {
  const r = tmp.repo();
  cli(r, ["add", "auth"]);
  cli(r, ["add", "gone"]);
  fs.rmSync(wt(r, "gone"), { recursive: true, force: true });
  const outside = `${r}-outside`;
  git(r, "worktree", "add", "-q", outside, "-b", "spike");
  write(path.join(outside, "scratch.txt"), "x");
  const lines = cli(r, ["list"]).stdout.trim().split("\n");
  expect(lines).toContain(`${wt(r, "auth")}\twt/auth\tclean\tunmerged`);
  expect(lines).toContain(`${wt(r, "gone")}\twt/gone\tmissing\tunmerged`);
  expect(lines).toContain(`${outside}\tspike\tdirty\tunmerged\toutside .worktrees`);
  expect(lines).toHaveLength(3);
});

it("removes only clean managed worktrees whose own commits reached the default branch", () => {
  const r = tmp.repo();
  const base = git(r, "rev-parse", "HEAD");
  for (const n of ["m", "fresh", "dirty", "un"]) cli(r, ["add", n]);
  for (const n of ["m", "dirty", "un"]) commitIn(wt(r, n), `${n}.txt`);
  git(r, "merge", "-q", "--no-edit", "wt/m");
  git(r, "merge", "-q", "--no-edit", "wt/dirty");
  write(path.join(wt(r, "dirty"), "loose.txt"), "x");
  const outside = `${r}-outside`;
  git(r, "worktree", "add", "-q", outside, "-b", "spike");
  git(r, "branch", "wt/o", "main");
  git(r, "update-ref", "refs/remotes/origin/main", "main");
  git(r, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(r, "switch", "-q", "-c", "other", base);
  const out = cli(r, ["prune"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toContain(`removed ${wt(r, "m")} (wt/m)`);
  expect(fs.existsSync(wt(r, "m"))).toBe(false);
  expect(hasBranch(r, "wt/m")).toBe(false);
  expect(hasBranch(r, "wt/o")).toBe(false);
  for (const n of ["fresh", "dirty", "un"]) expect(fs.existsSync(wt(r, n)), n).toBe(true);
  expect(fs.existsSync(outside)).toBe(true);
  expect(cli(r, ["prune"]).stdout).toBe("nothing to prune\n");
});

it("prints native real paths when the project dir is an alias of the repo", () => {
  const r = tmp.repo();
  const env = { CLAUDE_PROJECT_DIR: aliasOf(r) };
  const add = cli(r, ["add", "x"], { env });
  expect(add.status, add.stderr).toBe(0);
  expect(add.stdout).toBe(`${wt(r, "x")}\n`);
  commitIn(wt(r, "x"), "x.txt");
  git(r, "merge", "-q", "--no-edit", "wt/x");
  expect(cli(r, ["list"], { env }).stdout).toContain(`${wt(r, "x")}\twt/x\tclean\tmerged`);
  expect(cli(r, ["prune"], { env }).stdout).toContain(`removed ${wt(r, "x")} (wt/x)`);
});

it("judges managed paths on win32 the way git prints them", () => {
  expect(isManaged("C:/r/.worktrees/y", "C:\\r", path.win32)).toBe(true);
  expect(isManaged("C:\\r\\.worktrees\\y", "C:\\r", path.win32)).toBe(true);
  expect(isManaged("C:/r/.worktrees/a/b", "C:\\r", path.win32)).toBe(false);
  expect(isManaged("C:/elsewhere", "C:\\r", path.win32)).toBe(false);
});

const event = (r: string, data: object) => cli(path.join(r, "packages/a"), ["hook"], { input: JSON.stringify(data) });
const removing = (r: string, name: string) =>
  event(r, { hook_event_name: "WorktreeRemove", worktree_path: wt(r, name), cwd: r });

it("creates and removes Claude's worktrees through the hook", () => {
  const r = tmp.repo();
  const made = event(r, { hook_event_name: "WorktreeCreate", name: "z", cwd: path.join(r, "packages/a") });
  expect(made.status, made.stderr).toBe(0);
  expect(made.stdout).toBe(`${wt(r, "z")}\n`);
  const gone = removing(r, "z");
  expect(gone.status, gone.stderr).toBe(0);
  expect(fs.existsSync(wt(r, "z"))).toBe(false);
  expect(hasBranch(r, "wt/z")).toBe(false);
  expect(removing(r, "z").status).toBe(0);
  const other = event(r, { hook_event_name: "SessionStart", cwd: r });
  expect(other.status).toBe(0);
  expect(other.stdout).toBe("");
  const usage = cli(r, ["nope"]);
  expect(usage.status).toBe(2);
  expect(usage.stderr).toContain("usage: bun repo worktree add <name> | finish [<name>] | list | prune | hook");
});

it("keeps an unmerged branch the hook removed the worktree of, and drops a merged one", () => {
  const r = tmp.repo();
  event(r, { hook_event_name: "WorktreeCreate", name: "u", cwd: r });
  commitIn(wt(r, "u"), "u.txt");
  expect(removing(r, "u").status).toBe(0);
  expect(fs.existsSync(wt(r, "u"))).toBe(false);
  expect(hasBranch(r, "wt/u")).toBe(true);
  cli(r, ["add", "k"]);
  commitIn(wt(r, "k"), "k.txt");
  git(r, "merge", "-q", "--no-edit", "wt/k");
  git(r, "worktree", "remove", wt(r, "k"));
  expect(removing(r, "k").status).toBe(0);
  expect(hasBranch(r, "wt/k")).toBe(false);
});

it("adds and lists a worktree in process, has nothing to prune, and prints usage for no command", () => {
  const r = tmp.repo();
  expect(mainIn(r, ["add", "auth"])).toStrictEqual({ code: 0, stdout: `${wt(r, "auth")}\n`, stderr: "" });
  expect(mainIn(r, ["list"])).toStrictEqual({
    code: 0,
    stdout: `${wt(r, "auth")}\twt/auth\tclean\tunmerged\n`,
    stderr: "",
  });
  expect(mainIn(r, ["prune"])).toStrictEqual({ code: 0, stdout: "nothing to prune\n", stderr: "" });
  // No stdin given: main falls back to the process's own.
  const usage = captured(() => main([]));
  expect(usage.value).toBe(2);
  expect(usage.stderr).toMatch(/^Usage/i);
});
