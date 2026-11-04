import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import { isManaged, worktreeAddReason } from "./worktree.mjs";

const cli = path.join(import.meta.dirname, "worktree.mjs");
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) for (const x of [d, `${d}-alias`]) fs.rmSync(x, { recursive: true, force: true });
});

function tmpDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
}

/** The CLI with the harness project-dir vars removed, so the root comes from `cwd` unless a case sets one. */
function run(cwd: string, args: string[], { env = {}, input }: { env?: Record<string, string>; input?: string } = {}) {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["GROK_WORKSPACE_ROOT", "GEMINI_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]) delete e[k];
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...e, ...env }, input, encoding: "utf8" });
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function repo() {
  const r = tmpDir("wt-");
  git(r, "init", "-q", "-b", "main");
  git(r, "config", "core.autocrlf", "false");
  write(path.join(r, ".gitignore"), ".env\n.worktrees/\n");
  write(path.join(r, "packages/a/index.js"), "");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "init");
  return r;
}

function commitIn(dir: string, file: string) {
  write(path.join(dir, file), file);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", file);
}

const wt = (r: string, name: string) => path.join(r, ".worktrees", name);
const hasBranch = (r: string, b: string) => spawnSync("git", ["show-ref", "--verify", "-q", `refs/heads/${b}`], { cwd: r }).status === 0;

describe("worktree.mjs add", () => {
  it("makes .worktrees/<name> on wt/<name> from any start, once", () => {
    const r = repo();
    const first = run(path.join(r, "packages/a"), ["add", "auth"]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toBe(`${wt(r, "auth")}\n`);
    expect(git(wt(r, "auth"), "branch", "--show-current")).toBe("wt/auth");
    expect(git(wt(r, "auth"), "rev-parse", "HEAD")).toBe(git(r, "rev-parse", "HEAD"));
    expect(run(r, ["add", "auth"]).stdout).toBe(`${wt(r, "auth")}\n`);
    expect(git(r, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
    expect(run(wt(r, "auth"), ["add", "b"]).stdout).toBe(`${wt(r, "b")}\n`);
    const away = tmpDir("wt-away-");
    expect(run(away, ["add", "e"], { env: { CLAUDE_PROJECT_DIR: path.join(r, "packages/a") } }).stdout).toBe(`${wt(r, "e")}\n`);
  });

  it("copies missing gitignored .worktreeinclude matches and never overwrites", () => {
    const r = repo();
    write(path.join(r, ".worktreeinclude"), ".env\nnotes.txt\ntracked.cfg\n");
    write(path.join(r, "tracked.cfg"), "tracked\n");
    git(r, "add", "-A");
    git(r, "commit", "-qm", "include");
    write(path.join(r, ".env"), "SECRET=1\n");
    write(path.join(r, "notes.txt"), "loose\n");
    expect(run(r, ["add", "inc"]).status).toBe(0);
    const w = wt(r, "inc");
    expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("SECRET=1\n");
    expect(fs.existsSync(path.join(w, "notes.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(w, "tracked.cfg"), "utf8")).toBe("tracked\n");
    fs.rmSync(path.join(w, ".env"));
    run(r, ["add", "inc"]);
    expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("SECRET=1\n");
    write(path.join(w, ".env"), "LOCAL=1\n");
    run(r, ["add", "inc"]);
    expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("LOCAL=1\n");
  });

  it("cleans names, refuses unusable ones and foreign dirs, and attaches an existing wt/<name>", () => {
    const r = repo();
    expect(run(r, ["add", "feature/x y"]).stdout).toBe(`${wt(r, "feature-x-y")}\n`);
    const dots = run(r, ["add", ".."]);
    expect(dots.status).toBe(1);
    expect(dots.stdout).toBe("");
    expect(dots.stderr).toContain(`worktree name ".." has no usable characters; use letters, digits, ".", "_" or "-"`);
    write(path.join(wt(r, "c"), "keep.txt"), "mine\n");
    const busy = run(r, ["add", "c"]);
    expect(busy.status).toBe(1);
    expect(busy.stderr).toContain(`${wt(r, "c")} exists and is not a worktree of this repo; move it or pick another name`);
    expect(fs.readFileSync(path.join(wt(r, "c"), "keep.txt"), "utf8")).toBe("mine\n");
    git(r, "switch", "-q", "-c", "wt/d");
    commitIn(r, "d.txt");
    git(r, "switch", "-q", "main");
    const tip = git(r, "rev-parse", "wt/d");
    expect(run(r, ["add", "d"]).status).toBe(0);
    expect(git(wt(r, "d"), "rev-parse", "HEAD")).toBe(tip);
  });
});

describe("worktree.mjs list and prune", () => {
  it("lists every linked worktree with its state", () => {
    const r = repo();
    run(r, ["add", "auth"]);
    run(r, ["add", "gone"]);
    fs.rmSync(wt(r, "gone"), { recursive: true, force: true });
    const outside = `${r}-outside`;
    tmpDirs.push(outside);
    git(r, "worktree", "add", "-q", outside, "-b", "spike");
    write(path.join(outside, "scratch.txt"), "x");
    const lines = run(r, ["list"]).stdout.trim().split("\n");
    expect(lines).toContain(`${wt(r, "auth")}\twt/auth\tclean\tunmerged`);
    expect(lines).toContain(`${wt(r, "gone")}\twt/gone\tmissing\tunmerged`);
    expect(lines).toContain(`${outside}\tspike\tdirty\tunmerged\toutside .worktrees`);
    expect(lines).toHaveLength(3);
  });

  it("removes only clean managed worktrees whose own commits reached the default branch", () => {
    const r = repo();
    const base = git(r, "rev-parse", "HEAD");
    for (const n of ["m", "fresh", "dirty", "un"]) run(r, ["add", n]);
    commitIn(wt(r, "m"), "m.txt");
    commitIn(wt(r, "dirty"), "dirty.txt");
    commitIn(wt(r, "un"), "un.txt");
    git(r, "merge", "-q", "--no-edit", "wt/m");
    git(r, "merge", "-q", "--no-edit", "wt/dirty");
    write(path.join(wt(r, "dirty"), "loose.txt"), "x");
    const outside = `${r}-outside`;
    tmpDirs.push(outside);
    git(r, "worktree", "add", "-q", outside, "-b", "spike");
    git(r, "branch", "wt/o", "main");
    git(r, "update-ref", "refs/remotes/origin/main", "main");
    git(r, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git(r, "switch", "-q", "-c", "other", base);
    const out = run(r, ["prune"]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(`removed ${wt(r, "m")} (wt/m)`);
    expect(fs.existsSync(wt(r, "m"))).toBe(false);
    expect(hasBranch(r, "wt/m")).toBe(false);
    expect(hasBranch(r, "wt/o")).toBe(false);
    for (const n of ["fresh", "dirty", "un"]) expect(fs.existsSync(wt(r, n)), n).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
    expect(run(r, ["prune"]).stdout).toBe("nothing to prune\n");
  });

  it("prints native real paths when the project dir is an alias of the repo", () => {
    const r = repo();
    const env = { CLAUDE_PROJECT_DIR: aliasOf(r) };
    const add = run(r, ["add", "x"], { env });
    expect(add.status, add.stderr).toBe(0);
    expect(add.stdout).toBe(`${wt(r, "x")}\n`);
    commitIn(wt(r, "x"), "x.txt");
    git(r, "merge", "-q", "--no-edit", "wt/x");
    expect(run(r, ["list"], { env }).stdout).toContain(`${wt(r, "x")}\twt/x\tclean\tmerged`);
    expect(run(r, ["prune"], { env }).stdout).toContain(`removed ${wt(r, "x")} (wt/x)`);
  });

  it("judges managed paths on win32 the way git prints them", () => {
    expect(isManaged("C:/r/.worktrees/y", "C:\\r", path.win32)).toBe(true);
    expect(isManaged("C:\\r\\.worktrees\\y", "C:\\r", path.win32)).toBe(true);
    expect(isManaged("C:/r/.worktrees/a/b", "C:\\r", path.win32)).toBe(false);
    expect(isManaged("C:/elsewhere", "C:\\r", path.win32)).toBe(false);
  });
});

describe("worktree.mjs hook", () => {
  const event = (r: string, data: object) => run(path.join(r, "packages/a"), ["hook"], { input: JSON.stringify(data) });

  it("creates and removes Claude's worktrees, keeping unmerged branches", () => {
    const r = repo();
    const made = event(r, { hook_event_name: "WorktreeCreate", name: "z", cwd: path.join(r, "packages/a") });
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toBe(`${wt(r, "z")}\n`);
    const gone = event(r, { hook_event_name: "WorktreeRemove", worktree_path: wt(r, "z"), cwd: r });
    expect(gone.status, gone.stderr).toBe(0);
    expect(fs.existsSync(wt(r, "z"))).toBe(false);
    expect(hasBranch(r, "wt/z")).toBe(false);
    expect(event(r, { hook_event_name: "WorktreeRemove", worktree_path: wt(r, "z"), cwd: r }).status).toBe(0);

    event(r, { hook_event_name: "WorktreeCreate", name: "u", cwd: r });
    commitIn(wt(r, "u"), "u.txt");
    expect(event(r, { hook_event_name: "WorktreeRemove", worktree_path: wt(r, "u"), cwd: r }).status).toBe(0);
    expect(fs.existsSync(wt(r, "u"))).toBe(false);
    expect(hasBranch(r, "wt/u")).toBe(true);

    run(r, ["add", "k"]);
    commitIn(wt(r, "k"), "k.txt");
    git(r, "merge", "-q", "--no-edit", "wt/k");
    git(r, "worktree", "remove", wt(r, "k"));
    expect(event(r, { hook_event_name: "WorktreeRemove", worktree_path: wt(r, "k"), cwd: r }).status).toBe(0);
    expect(hasBranch(r, "wt/k")).toBe(false);

    const other = event(r, { hook_event_name: "SessionStart", cwd: r });
    expect(other.status).toBe(0);
    expect(other.stdout).toBe("");
    const usage = run(r, ["nope"]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("usage: worktree.mjs add <name> | list | prune | hook");
  });
});

describe("worktreeAddReason", () => {
  it("denies worktrees outside .worktrees/<name> on wt/<name>", () => {
    const r = repo();
    const roots = { root: r, checkout: r, cwd: r };
    expect(worktreeAddReason("git worktree add ../elsewhere -b spike", roots, r)).toBe(
      `worktrees live in ${path.join(r, ".worktrees", "<name>")} on branch wt/<name>: run node ${path.join(r, ".rulesync", "scripts", "worktree.mjs")} add spike`,
    );
    for (const cmd of [
      "git -C .. worktree add x",
      "cd /tmp && git worktree add w",
      "git worktree add .worktrees/a/b",
      "git worktree add .worktrees/y",
      "git worktree add .worktrees/y -b y",
      "git worktree add --detach .worktrees/y",
    ]) {
      expect(worktreeAddReason(cmd, roots, r), cmd).toMatch(/^worktrees live in /);
    }
    for (const cmd of [
      "git worktree add .worktrees/y -b wt/y",
      // As typed in bash: an unquoted `\` is an escape there, so a Windows path goes in with `/`.
      `git worktree add -b wt/z ${r.split(path.sep).join("/")}/.worktrees/z main`,
      "git worktree add .worktrees/y wt/y",
      "git worktree list",
      "git worktree remove .worktrees/y",
      'git worktree add "$DIR"',
    ]) {
      expect(worktreeAddReason(cmd, roots, r), cmd).toBeNull();
    }
  });

  it("reads win32 paths", () => {
    const roots = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r" };
    expect(worktreeAddReason("git worktree add 'C:\\r\\.worktrees\\y' -b wt/y", roots, "C:\\r", path.win32)).toBeNull();
    expect(worktreeAddReason("git worktree add 'C:\\elsewhere'", roots, "C:\\r", path.win32)).toMatch(/^worktrees live in /);
  });
});
