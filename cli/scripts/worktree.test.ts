import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUN, aliasOf } from "../../dev/test-paths";
import {
  gitAskedWords,
  isManaged,
  main,
  mainCheckoutWriteReason,
  managedLessonsDir,
  sharedGitReason,
  worktreeAddReason,
} from "./worktree.ts";
import { childEnv } from "../env.ts";

const repoBin = path.join(import.meta.dirname, "../../bin/repo.ts");
/** The Windows command that finds an executable on PATH. */
const WHERE = "where";

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
  const e = childEnv({ GROK_WORKSPACE_ROOT: undefined, CLAUDE_PROJECT_DIR: undefined });
  // win32 env names ignore case, so an override of PATH must drop the inherited Path.
  for (const k of Object.keys(e)) if (Object.keys(env).some((o) => o.toLowerCase() === k.toLowerCase())) delete e[k];
  return spawnSync(BUN, [repoBin, "worktree", ...args], { cwd, env: { ...e, ...env }, input, encoding: "utf8" });
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
const hasBranch = (r: string, b: string) =>
  spawnSync("git", ["show-ref", "--verify", "-q", `refs/heads/${b}`], { cwd: r }).status === 0;

describe("worktree.ts add", () => {
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
    expect(run(away, ["add", "e"], { env: { CLAUDE_PROJECT_DIR: path.join(r, "packages/a") } }).stdout).toBe(
      `${wt(r, "e")}\n`,
    );
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
    expect(busy.stderr).toContain(
      `${wt(r, "c")} exists and is not a worktree of this repo; move it or pick another name`,
    );
    expect(fs.readFileSync(path.join(wt(r, "c"), "keep.txt"), "utf8")).toBe("mine\n");
    git(r, "switch", "-q", "-c", "wt/d");
    commitIn(r, "d.txt");
    git(r, "switch", "-q", "main");
    const tip = git(r, "rev-parse", "wt/d");
    expect(run(r, ["add", "d"]).status).toBe(0);
    expect(git(wt(r, "d"), "rev-parse", "HEAD")).toBe(tip);
  });
});

/** A repo whose package.json has a `postinstall` and a local `file:` dependency, with a real bun.lock made by one offline `bun install`. */
function bunRepo(postinstall: string) {
  const r = repo();
  const pkg = (scripts: object) =>
    `${JSON.stringify({ name: "fixture", version: "1.0.0", scripts, dependencies: { dep: "file:./vendor/dep" } }, null, 2)}\n`;
  write(path.join(r, ".gitignore"), ".env\n.worktrees/\nnode_modules/\n");
  write(path.join(r, "vendor/dep/package.json"), `${JSON.stringify({ name: "dep", version: "1.0.0" })}\n`);
  write(path.join(r, "package.json"), pkg({}));
  execFileSync("bun", ["install"], { cwd: r, stdio: "ignore" });
  write(path.join(r, "package.json"), pkg({ postinstall }));
  git(r, "add", "-A");
  git(r, "commit", "-qm", "bun");
  return r;
}

const MARK = `node -e "require('fs').writeFileSync('installed.marker','1')"`;
const marker = (dir: string) => fs.existsSync(path.join(dir, "installed.marker"));

describe("worktree.ts add installs dependencies", () => {
  it("runs bun install --frozen-lockfile in a new worktree only, keeping stdout to the path", () => {
    const r = bunRepo(MARK);
    expect(marker(r)).toBe(false);
    const first = run(r, ["add", "dep"]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toBe(`${wt(r, "dep")}\n`);
    expect(first.stderr).not.toContain("could not install");
    expect(marker(wt(r, "dep"))).toBe(true);
    fs.rmSync(path.join(wt(r, "dep"), "installed.marker"));
    const again = run(r, ["add", "dep"]);
    expect(again.stdout).toBe(`${wt(r, "dep")}\n`);
    expect(marker(wt(r, "dep"))).toBe(false);
    expect(marker(r)).toBe(false);
  });

  it("also tries the install for a legacy bun.lockb", () => {
    const r = bunRepo(MARK);
    git(r, "rm", "-qf", "bun.lock");
    write(path.join(r, "bun.lockb"), "not a real binary lockfile");
    git(r, "add", "-A");
    git(r, "commit", "-qm", "legacy");
    const made = run(r, ["add", "old"]);
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toBe(`${wt(r, "old")}\n`);
    expect(made.stderr).toContain(
      `could not install dependencies in ${wt(r, "old")}: run bun install --frozen-lockfile there`,
    );
  });

  it("skips the install without a lockfile", () => {
    const r = repo();
    write(path.join(r, "package.json"), `${JSON.stringify({ name: "f", scripts: { postinstall: MARK } })}\n`);
    git(r, "add", "-A");
    git(r, "commit", "-qm", "pkg");
    const made = run(r, ["add", "bare"]);
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toBe(`${wt(r, "bare")}\n`);
    expect(marker(wt(r, "bare"))).toBe(false);
  });

  it("reports a failed install in one stderr line and still prints the path", () => {
    const r = bunRepo("exit 1");
    const made = run(r, ["add", "bad"]);
    expect(made.status).toBe(0);
    expect(made.stdout).toBe(`${wt(r, "bad")}\n`);
    const lines = made.stderr.split("\n").filter((l) => l.includes("could not install"));
    expect(lines).toEqual([
      `could not install dependencies in ${wt(r, "bad")}: run bun install --frozen-lockfile there`,
    ]);
  });

  it("reports a missing bun the same way", () => {
    const r = bunRepo(MARK);
    // A PATH with git and no bun: a lone git link on posix; git's own cmd dir on win32, where git.exe needs its install.
    const bin =
      process.platform === "win32"
        ? path.dirname(execFileSync(WHERE, ["git"], { encoding: "utf8" }).split(/\r?\n/)[0] ?? "")
        : tmpDir("wt-bin-");
    if (process.platform !== "win32")
      fs.symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), path.join(bin, "git"));
    const made = run(r, ["add", "nobun"], { env: { PATH: bin } });
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toBe(`${wt(r, "nobun")}\n`);
    expect(made.stderr).toContain(
      `could not install dependencies in ${wt(r, "nobun")}: run bun install --frozen-lockfile there`,
    );
    expect(marker(wt(r, "nobun"))).toBe(false);
  });

  it("keeps the WorktreeCreate hook's stdout to the path", () => {
    const r = bunRepo(MARK);
    const made = run(r, ["hook"], { input: JSON.stringify({ hook_event_name: "WorktreeCreate", name: "hk", cwd: r }) });
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toBe(`${wt(r, "hk")}\n`);
    expect(marker(wt(r, "hk"))).toBe(true);
  });
});

describe("worktree.ts list and prune", () => {
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

describe("worktree.ts hook", () => {
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
    expect(usage.stderr).toContain("usage: bun repo worktree add <name> | finish [<name>] | list | prune | hook");
  });
});

describe("worktree.ts main in process", () => {
  const saved = { cwd: process.cwd() };
  afterEach(() => {
    process.chdir(saved.cwd);
    vi.restoreAllMocks();
  });

  /** Runs `main(args)` in `cwd` with the harness project-dir vars removed, capturing what it prints. */
  function mainIn(cwd: string, args: string[]) {
    for (const k of ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"]) vi.stubEnv(k, undefined);
    process.chdir(cwd);
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
    const code = main(args);
    vi.restoreAllMocks();
    return { code, stdout: out.join(""), stderr: err.join("") };
  }

  it("adds and lists a worktree, has nothing to prune, and prints usage for no command", () => {
    const r = repo();
    expect(mainIn(r, ["add", "auth"])).toEqual({ code: 0, stdout: `${wt(r, "auth")}\n`, stderr: "" });
    expect(mainIn(r, ["list"])).toEqual({
      code: 0,
      stdout: `${wt(r, "auth")}\twt/auth\tclean\tunmerged\n`,
      stderr: "",
    });
    expect(mainIn(r, ["prune"])).toEqual({ code: 0, stdout: "nothing to prune\n", stderr: "" });
    const usage = mainIn(r, []);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toMatch(/^Usage/i);
  });
});

describe("worktreeAddReason", () => {
  it("denies worktrees outside .worktrees/<name> on wt/<name>", () => {
    const r = repo();
    const roots = { root: r, checkout: r, cwd: r };
    expect(worktreeAddReason("git worktree add ../elsewhere -b spike", roots, r)).toBe(
      `worktrees live in ${path.join(r, ".worktrees", "<name>")} on branch wt/<name>: run bun repo worktree add spike`,
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
    expect(worktreeAddReason("git worktree add 'C:\\elsewhere'", roots, "C:\\r", path.win32)).toMatch(
      /^worktrees live in /,
    );
  });
});

function commitText(dir: string, file: string, text: string) {
  write(path.join(dir, file), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", file);
}

describe("worktree.ts finish", () => {
  const short = (r: string, ref: string) => git(r, "rev-parse", "--short", ref);
  const subjects = (r: string, ref = "main") => git(r, "log", "--format=%s", ref).split("\n");

  /** A repo with a committer identity, since finish rebases through the CLI's own git. */
  function ready() {
    const r = repo();
    git(r, "config", "user.email", "t@t");
    git(r, "config", "user.name", "t");
    return r;
  }

  function pinOriginHead(r: string) {
    git(r, "update-ref", "refs/remotes/origin/main", "main");
    git(r, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }

  /** A post-rewrite hook that commits to the default branch in the root, once or on every rebase. */
  function raceHook(r: string, once: boolean) {
    const sh = (p: string) => p.split(path.sep).join("/");
    const marker = sh(path.join(r, ".git", "raced"));
    const hook = path.join(r, ".git", "hooks", "post-rewrite");
    write(
      hook,
      [
        "#!/bin/sh",
        "unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX",
        ...(once ? [`[ -e '${marker}' ] && exit 0`, `: > '${marker}'`] : []),
        `git -c user.email=t@t -c user.name=t -C '${sh(r)}' commit -q --allow-empty -m raced`,
        "",
      ].join("\n"),
    );
    fs.chmodSync(hook, 0o755);
  }

  it("fast-forwards the default branch with one commit and removes the worktree and branch", () => {
    const r = ready();
    run(r, ["add", "a"]);
    commitIn(wt(r, "a"), "a.txt");
    const tip = git(wt(r, "a"), "rev-parse", "HEAD");
    const out = run(r, ["finish", "a"]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toBe(
      `merged wt/a into main at ${short(r, "main")} and removed ${wt(r, "a")}; your shell may still be in it: cd ${r}\n`,
    );
    expect(git(r, "rev-parse", "main")).toBe(tip);
    expect(git(r, "branch", "--show-current")).toBe("main");
    expect(fs.readFileSync(path.join(r, "a.txt"), "utf8")).toBe("a.txt");
    expect(fs.existsSync(wt(r, "a"))).toBe(false);
    expect(hasBranch(r, "wt/a")).toBe(false);
  });

  it("rebases onto a default branch that moved, leaving a linear history", () => {
    const r = ready();
    run(r, ["add", "a"]);
    commitIn(wt(r, "a"), "a.txt");
    commitIn(r, "m.txt");
    const out = run(r, ["finish", "a"]);
    expect(out.status, out.stderr).toBe(0);
    expect(git(r, "rev-list", "--merges", "main")).toBe("");
    expect(subjects(r)).toEqual(["a.txt", "m.txt", "init"]);
    expect(fs.existsSync(path.join(r, "m.txt")) && fs.existsSync(path.join(r, "a.txt"))).toBe(true);
    expect(hasBranch(r, "wt/a")).toBe(false);
  });

  it("aborts a conflicting rebase, names the file and keeps the worktree", () => {
    const r = ready();
    run(r, ["add", "c"]);
    commitText(wt(r, "c"), "packages/a/index.js", "wt\n");
    commitText(r, "packages/a/index.js", "main\n");
    const before = git(r, "rev-parse", "main");
    const w = wt(r, "c");
    const out = run(r, ["finish", "c"]);
    expect(out.status).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe(
      `rebasing wt/c onto main conflicts in packages/a/index.js: run git -C ${w} rebase main, fix each file, git -C ${w} add <file>, git -C ${w} rebase --continue, rerun the checks, then run finish again\n`,
    );
    expect(git(r, "rev-parse", "main")).toBe(before);
    expect(git(w, "branch", "--show-current")).toBe("wt/c");
    expect(git(w, "status", "--porcelain")).toBe("");
    expect(hasBranch(r, "wt/c")).toBe(true);
    expect(run(r, ["finish", "c"]).stderr).toContain("conflicts in packages/a/index.js");
  });

  it("refuses a worktree that is mid-rebase", () => {
    const r = ready();
    run(r, ["add", "c"]);
    const w = wt(r, "c");
    commitText(w, "packages/a/index.js", "wt\n");
    commitText(r, "packages/a/index.js", "main\n");
    const before = git(r, "rev-parse", "main");
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "rebase", "main"], { cwd: w });
    const out = run(r, ["finish", "c"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toBe(
      `${w} is mid-rebase: finish it with git -C ${w} rebase --continue (or --abort), then run finish again\n`,
    );
    expect(git(r, "rev-parse", "main")).toBe(before);
    expect(fs.existsSync(w)).toBe(true);
  });

  it("refuses uncommitted changes, untracked files included, and moves nothing", () => {
    const r = ready();
    run(r, ["add", "d"]);
    const w = wt(r, "d");
    commitIn(w, "d.txt");
    const before = git(r, "rev-parse", "main");
    write(path.join(w, "packages/a/index.js"), "edited\n");
    write(path.join(w, "loose.txt"), "x");
    const two = run(r, ["finish", "d"]);
    expect(two.status).toBe(1);
    expect(two.stderr).toBe(`${w} has uncommitted changes in 2 files: commit or drop them, then run finish again\n`);
    git(w, "checkout", "-q", "--", "packages/a/index.js");
    const one = run(r, ["finish", "d"]);
    expect(one.status).toBe(1);
    expect(one.stderr).toBe(`${w} has uncommitted changes in 1 file: commit or drop them, then run finish again\n`);
    expect(git(r, "rev-parse", "main")).toBe(before);
    expect(hasBranch(r, "wt/d")).toBe(true);
    expect(fs.existsSync(w)).toBe(true);
  });

  it("removes a worktree with no commits of its own and says so", () => {
    const r = ready();
    run(r, ["add", "empty"]);
    commitIn(r, "m.txt");
    const before = git(r, "rev-parse", "main");
    const out = run(r, ["finish", "empty"]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toBe(`wt/empty has no commits of its own; removed ${wt(r, "empty")}\n`);
    expect(git(r, "rev-parse", "main")).toBe(before);
    expect(fs.existsSync(wt(r, "empty"))).toBe(false);
    expect(hasBranch(r, "wt/empty")).toBe(false);
  });

  it("names the list command for an unknown worktree", () => {
    const r = ready();
    const out = run(r, ["finish", "nosuch"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toBe(`no worktree or branch named nosuch: bun repo worktree list shows them\n`);
  });

  it("converges when a crashed run left the work merged", () => {
    const r = ready();
    run(r, ["add", "gone"]);
    commitIn(wt(r, "gone"), "gone.txt");
    git(r, "merge", "-q", "--ff-only", "wt/gone");
    git(r, "worktree", "remove", wt(r, "gone"));
    const before = git(r, "rev-parse", "main");
    const rerun = run(r, ["finish", "gone"]);
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.stdout).toContain("merged wt/gone into main at ");
    expect(hasBranch(r, "wt/gone")).toBe(false);
    expect(git(r, "rev-parse", "main")).toBe(before);

    run(r, ["add", "kept"]);
    commitIn(wt(r, "kept"), "kept.txt");
    git(r, "merge", "-q", "--ff-only", "wt/kept");
    const again = run(r, ["finish", "kept"]);
    expect(again.status, again.stderr).toBe(0);
    expect(fs.existsSync(wt(r, "kept"))).toBe(false);
    expect(hasBranch(r, "wt/kept")).toBe(false);
    expect(run(r, ["finish", "kept"]).status).toBe(1);
  });

  it("advances the default ref while the main checkout sits on another branch", () => {
    const r = ready();
    pinOriginHead(r);
    git(r, "switch", "-q", "-c", "other");
    run(r, ["add", "o"]);
    commitIn(wt(r, "o"), "o.txt");
    const tip = git(wt(r, "o"), "rev-parse", "HEAD");
    const out = run(r, ["finish", "o"]);
    expect(out.status, out.stderr).toBe(0);
    expect(git(r, "rev-parse", "main")).toBe(tip);
    expect(git(r, "branch", "--show-current")).toBe("other");
    expect(fs.existsSync(path.join(r, "o.txt"))).toBe(false);
    expect(hasBranch(r, "wt/o")).toBe(false);
    expect(fs.existsSync(wt(r, "o"))).toBe(false);
  });

  it("lands on main, not on the branch the root sits on, when there is no origin/HEAD", () => {
    const r = ready();
    git(r, "switch", "-q", "-c", "feature");
    run(r, ["add", "f"]);
    commitIn(wt(r, "f"), "f.txt");
    const tip = git(wt(r, "f"), "rev-parse", "HEAD");
    const featureTip = git(r, "rev-parse", "feature");
    const out = run(r, ["finish", "f"]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(`merged wt/f into main at ${short(r, "main")}`);
    expect(git(r, "rev-parse", "main")).toBe(tip);
    expect(git(r, "rev-parse", "feature")).toBe(featureTip);
    expect(git(r, "branch", "--show-current")).toBe("feature");
    expect(fs.existsSync(path.join(r, "f.txt"))).toBe(false);
  });

  it("prefers init.defaultBranch, then master, when main does not exist", () => {
    const r = ready();
    git(r, "branch", "-m", "main", "trunk");
    git(r, "switch", "-q", "-c", "feature");
    git(r, "config", "init.defaultBranch", "trunk");
    run(r, ["add", "t"]);
    commitIn(wt(r, "t"), "t.txt");
    const tip = git(wt(r, "t"), "rev-parse", "HEAD");
    expect(run(r, ["finish", "t"]).status).toBe(0);
    expect(git(r, "rev-parse", "trunk")).toBe(tip);

    const m = ready();
    git(m, "branch", "-m", "main", "master");
    git(m, "switch", "-q", "-c", "feature");
    run(m, ["add", "m"]);
    commitIn(wt(m, "m"), "m.txt");
    const masterTip = git(wt(m, "m"), "rev-parse", "HEAD");
    expect(run(m, ["finish", "m"]).status).toBe(0);
    expect(git(m, "rev-parse", "master")).toBe(masterTip);
  });

  it("falls back to the branch the root sits on when no default branch is named or present", () => {
    const r = ready();
    git(r, "branch", "-m", "main", "develop");
    run(r, ["add", "d"]);
    commitIn(wt(r, "d"), "d.txt");
    const tip = git(wt(r, "d"), "rev-parse", "HEAD");
    const out = run(r, ["finish", "d"]);
    expect(out.status, out.stderr).toBe(0);
    expect(git(r, "rev-parse", "develop")).toBe(tip);
  });

  it("converges when another session's prune removed the worktree right after the fast-forward", () => {
    const r = ready();
    run(r, ["add", "p"]);
    commitIn(wt(r, "p"), "p.txt");
    const tip = git(wt(r, "p"), "rev-parse", "HEAD");
    const sh = (x: string) => x.split(path.sep).join("/");
    const hook = path.join(r, ".git", "hooks", "post-merge");
    write(
      hook,
      [
        "#!/bin/sh",
        "unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX",
        `git -C '${sh(r)}' worktree remove --force '${sh(wt(r, "p"))}'`,
        "",
      ].join("\n"),
    );
    fs.chmodSync(hook, 0o755);
    const out = run(r, ["finish", "p"]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(`merged wt/p into main at ${short(r, "main")}`);
    expect(git(r, "rev-parse", "main")).toBe(tip);
    expect(hasBranch(r, "wt/p")).toBe(false);
    expect(git(r, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  it("reports git's reason when the main checkout's own changes block the fast-forward", () => {
    const r = ready();
    run(r, ["add", "b"]);
    commitText(wt(r, "b"), "packages/a/index.js", "wt\n");
    write(path.join(r, "packages/a/index.js"), "local\n");
    const before = git(r, "rev-parse", "main");
    const out = run(r, ["finish", "b"]);
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
    const r = ready();
    run(r, ["add", "n"]);
    commitIn(wt(r, "n"), "n.txt");
    const none = run(r, ["finish"]);
    expect(none.status).toBe(2);
    expect(none.stderr).toBe("run finish inside .worktrees/<name> or pass its name\n");
    expect(fs.existsSync(wt(r, "n"))).toBe(true);
    const inside = run(path.join(wt(r, "n"), "packages/a"), ["finish"]);
    expect(inside.status, inside.stderr).toBe(0);
    expect(inside.stdout).toBe(
      `merged wt/n into main at ${short(r, "main")} and removed ${wt(r, "n")}; your shell may still be in it: cd ${r}\n`,
    );
    expect(fs.existsSync(wt(r, "n"))).toBe(false);
  });

  it("retries the rebase once when the default branch moves during it", () => {
    const r = ready();
    run(r, ["add", "race"]);
    commitIn(wt(r, "race"), "race.txt");
    commitIn(r, "m.txt");
    raceHook(r, true);
    const out = run(r, ["finish", "race"]);
    expect(out.status, out.stderr).toBe(0);
    expect(subjects(r)).toEqual(["race.txt", "raced", "m.txt", "init"]);
    expect(git(r, "rev-list", "--merges", "main")).toBe("");
    expect(hasBranch(r, "wt/race")).toBe(false);
    expect(fs.existsSync(wt(r, "race"))).toBe(false);
  });

  it("gives up after three tries when the default branch moves every time", () => {
    const r = ready();
    run(r, ["add", "race"]);
    commitIn(wt(r, "race"), "race.txt");
    commitIn(r, "m.txt");
    raceHook(r, false);
    const out = run(r, ["finish", "race"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toBe("main kept moving while finishing wt/race; run finish again\n");
    expect(subjects(r).filter((s) => s === "raced")).toHaveLength(3);
    expect(subjects(r)).not.toContain("race.txt");
    expect(hasBranch(r, "wt/race")).toBe(true);
    expect(fs.existsSync(wt(r, "race"))).toBe(true);
  });
});

describe("sharedGitReason", () => {
  const none = new Set<string>();
  const rootsOf = (r: string, checkout = r) => ({ root: r, checkout, cwd: checkout });
  const commitMaking = {
    commit: "git commit -m x",
    merge: "git merge wt/a",
    "cherry-pick": "git cherry-pick abc",
    revert: "git revert HEAD",
    am: "git am p.patch",
    pull: "git pull",
  };
  const destructive = {
    stash: "git stash",
    reset: "git reset --hard",
    checkout: "git checkout main",
    switch: "git switch main",
    restore: "git restore f",
    clean: "git clean -fd",
    rebase: "git rebase main",
  };

  function withWorktrees() {
    const r = repo();
    run(r, ["add", "a"]);
    run(r, ["add", "b"]);
    return r;
  }

  it("denies the 13 commit-making and destructive subcommands in the main checkout, and a named one passes", () => {
    const r = withWorktrees();
    const roots = rootsOf(r);
    for (const [sub, cmd] of Object.entries(commitMaking)) {
      expect(sharedGitReason(cmd, roots, r, none), cmd).toBe(
        `the main checkout is shared: commit inside ${path.join(r, ".worktrees", "<name>")}, then run bun repo worktree finish <name>`,
      );
      expect(sharedGitReason(cmd, roots, r, new Set([sub])), `${cmd} asked`).toBeNull();
      expect(sharedGitReason(cmd, roots, r, new Set(["stash"])), `${cmd} other word`).not.toBeNull();
    }
    for (const [sub, cmd] of Object.entries(destructive)) {
      expect(sharedGitReason(cmd, roots, r, none), cmd).toBe(
        `git ${sub} in the main checkout can destroy other sessions' work: do it inside your worktree, or run it here only when the user's message asks for git ${sub}`,
      );
      expect(sharedGitReason(cmd, roots, r, new Set([sub])), `${cmd} asked`).toBeNull();
    }
    expect(sharedGitReason("cd packages/a && git stash", roots, r, none)).not.toBeNull();
    expect(sharedGitReason("git -C packages/a commit -m x", roots, r, none)).not.toBeNull();
    expect(sharedGitReason("git -c core.editor=true commit -m x", roots, r, none)).not.toBeNull();
    expect(sharedGitReason("git add -A && git commit -m x", roots, r, none)).not.toBeNull();
  });

  it("lets every git command run inside your own worktree and denies the main checkout from there", () => {
    const r = withWorktrees();
    const a = wt(r, "a");
    for (const cmd of [
      "git stash",
      "git reset --hard",
      "git checkout main",
      "git rebase main",
      "git commit --amend",
      "git clean -fd",
    ]) {
      expect(sharedGitReason(`cd .worktrees/a && ${cmd}`, rootsOf(r), r, none), cmd).toBeNull();
      expect(sharedGitReason(cmd.replace("git ", "git -C .worktrees/a "), rootsOf(r), r, none), cmd).toBeNull();
      expect(sharedGitReason(cmd, rootsOf(r, a), a, none), cmd).toBeNull();
    }
    expect(sharedGitReason("git -C packages/a stash", rootsOf(r, a), path.join(a, "packages/a"), none)).toBeNull();
    expect(sharedGitReason(`git -C ${r.split(path.sep).join("/")} commit -m x`, rootsOf(r, a), a, none)).toMatch(
      /^the main checkout is shared: commit inside /,
    );
    expect(sharedGitReason("git -C ../.. stash", rootsOf(r, a), a, none)).toMatch(/^git stash in the main checkout /);
    expect(
      sharedGitReason(
        "git status && git log --oneline && git diff && git add -A && git worktree list",
        rootsOf(r),
        r,
        none,
      ),
    ).toBeNull();
    expect(sharedGitReason('git -C "$DIR" stash', rootsOf(r), r, none)).toBeNull();
  });

  it("guards the default branch and force pushes but frees other worktrees and wt/* branches", () => {
    const r = withWorktrees();
    const a = wt(r, "a");
    const from = rootsOf(r, a);
    expect(sharedGitReason("git branch -D wt/b", from, a, none)).toBeNull();
    expect(sharedGitReason("git branch -m wt/b renamed", from, a, none)).toBeNull();
    expect(sharedGitReason("git branch -D wt/b", rootsOf(r), r, none)).toBeNull();
    expect(sharedGitReason("git branch -d scratch wt/b", from, a, none)).toBeNull();
    expect(sharedGitReason("git branch -D scratch wt/b main", from, a, none)).toMatch(
      /^main is the shared default branch/,
    );
    expect(sharedGitReason("git worktree remove .worktrees/b", from, a, none)).toBeNull();
    expect(sharedGitReason("git worktree remove ../b", from, a, none)).toBeNull();
    expect(sharedGitReason("git worktree remove --force .worktrees/b", rootsOf(r), r, none)).toBeNull();
    expect(sharedGitReason(`git worktree remove ${wt(r, "b").split(path.sep).join("/")}`, from, a, none)).toBeNull();
    expect(sharedGitReason("git push --force origin wt/b", from, a, none)).toMatch(
      /^a force push rewrites shared history/,
    );
    const shared: [string, string][] = [
      ["git branch -D main", "branch"],
      ["git branch -d main", "branch"],
      ["git branch -M main", "branch"],
      ["git branch -f main HEAD~1", "branch"],
      ["git update-ref refs/heads/main x", "update-ref"],
      ["git update-ref -d refs/heads/main", "update-ref"],
    ];
    for (const [cmd, sub] of shared) {
      const reason = `main is the shared default branch: move it only with bun repo worktree finish <name>, or when the user's message asks for git ${sub}`;
      expect(sharedGitReason(cmd, from, a, none), cmd).toBe(reason);
      expect(sharedGitReason(cmd, rootsOf(r), r, none), cmd).toBe(reason);
      expect(sharedGitReason(cmd, from, a, new Set([sub])), `${cmd} asked`).toBeNull();
    }
    expect(sharedGitReason("git branch -D wt/b", from, a, new Set(["branch"]))).toBeNull();
    expect(sharedGitReason("git worktree remove ../b", from, a, new Set(["worktree"]))).toBeNull();
    for (const cmd of [
      "git branch -D scratch",
      "git branch -f scratch main",
      "git branch scratch main",
      "git branch -D wt/a",
      "git branch --list",
      "git branch -vv",
      "git worktree remove ../a",
      "git worktree remove .worktrees/a",
      "git worktree remove /somewhere/else",
      "git update-ref refs/heads/scratch x",
      "git update-ref refs/stash x",
    ]) {
      expect(sharedGitReason(cmd, from, a, none), cmd).toBeNull();
    }
  });

  it("denies a force push anywhere in the repo unless force was asked", () => {
    const r = withWorktrees();
    const reason = "a force push rewrites shared history: run it only when the user's message asks for a force push";
    for (const cmd of [
      "git push --force",
      "git push -f",
      "git push origin +main",
      "git push --force-with-lease origin main",
      "git push -fu origin main",
      "git push origin main:main +wt/a",
    ]) {
      for (const [roots, cwd] of [
        [rootsOf(r), r],
        [rootsOf(r, wt(r, "a")), wt(r, "a")],
      ] as const) {
        expect(sharedGitReason(cmd, roots, cwd, none), cmd).toBe(reason);
        expect(sharedGitReason(cmd, roots, cwd, new Set(["force"])), `${cmd} asked`).toBeNull();
        expect(sharedGitReason(cmd, roots, cwd, new Set(["push"])), `${cmd} wrong word`).toBe(reason);
      }
    }
    for (const cmd of [
      "git push",
      "git push origin main",
      "git push -u origin HEAD",
      "git push --follow-tags",
      "git push --delete origin x",
    ]) {
      expect(sharedGitReason(cmd, rootsOf(r), r, none), cmd).toBeNull();
    }
    expect(sharedGitReason("git -C /somewhere/else push --force", rootsOf(r), r, none)).toBeNull();
  });

  it("checks a git command behind an rtk or env prefix like the bare one", () => {
    const r = withWorktrees();
    const a = wt(r, "a");
    for (const cmd of [
      "rtk git stash",
      "env A=1 git stash",
      "env A=1 B=2 git stash",
      "A=1 rtk git stash",
      "rtk env A=1 git stash",
      "cd packages && /usr/bin/git stash",
    ]) {
      expect(sharedGitReason(cmd, rootsOf(r), r, none), cmd).toMatch(/^git stash in the main checkout /);
      expect(sharedGitReason(cmd, rootsOf(r), r, new Set(["stash"])), `${cmd} asked`).toBeNull();
      expect(sharedGitReason(cmd, rootsOf(r, a), a, none), `${cmd} in own worktree`).toBeNull();
    }
    expect(sharedGitReason("rtk git commit -m x", rootsOf(r), r, none)).toMatch(/^the main checkout is shared/);
    expect(sharedGitReason("rtk git push --force", rootsOf(r, a), a, none)).toMatch(/^a force push/);
    expect(sharedGitReason("env A=1 git -C .worktrees/a reset --hard", rootsOf(r), r, none)).toBeNull();
    expect(sharedGitReason("rtk git status", rootsOf(r), r, none)).toBeNull();
    expect(sharedGitReason("rtk cargo build", rootsOf(r), r, none)).toBeNull();
    expect(sharedGitReason("env A=1 echo git stash", rootsOf(r), r, none)).toBeNull();
  });

  it("does not read a heredoc body as commands, but reads what follows it", () => {
    const r = withWorktrees();
    const roots = rootsOf(r);
    for (const open of ["<<'EOF'", '<<"EOF"', "<<EOF", "<<-EOF", "<< 'EOF'"]) {
      const body = `cat > notes.md ${open}\ngit stash\ngit push --force\ngit worktree add ../x\ngit commit -m x\nEOF`;
      expect(sharedGitReason(body, roots, r, none), open).toBeNull();
      expect(worktreeAddReason(body, roots, r), open).toBeNull();
      expect(sharedGitReason(`${body}\ngit stash`, roots, r, none), `${open} then stash`).toMatch(
        /^git stash in the main checkout /,
      );
      expect(sharedGitReason(`git stash <<'EOF'\nx\nEOF`, roots, r, none), `${open} command before body`).toMatch(
        /^git stash in the main checkout /,
      );
    }
    expect(sharedGitReason("cat <<-EOF\n\tgit stash\n\tEOF\ngit commit -m x", roots, r, none)).toMatch(
      /^the main checkout is shared/,
    );
    expect(sharedGitReason("cat <<A <<B\ngit stash\nA\ngit commit -m y\nB\ngit reset --hard", roots, r, none)).toMatch(
      /^git reset in the main checkout /,
    );
    expect(sharedGitReason("cat <<'EOF'\ngit stash\nno terminator", roots, r, none)).toBeNull();
    expect(sharedGitReason("echo a << 3 && git stash", roots, r, none)).toMatch(/^git stash in the main checkout /);
  });

  it("passes outside a git repo and before the first commit", () => {
    const plain = tmpDir("wt-plain-");
    const unborn = tmpDir("wt-unborn-");
    git(unborn, "init", "-q", "-b", "main");
    for (const dir of [plain, unborn]) {
      for (const cmd of ["git commit -m x", "git stash", "git push --force", "git branch -D main"]) {
        expect(sharedGitReason(cmd, rootsOf(dir), dir, none), `${dir} ${cmd}`).toBeNull();
      }
    }
  });

  it("reads win32 spellings of the root and its worktrees", () => {
    const roots = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r" };
    const inA = { ...roots, checkout: "C:\\r\\.worktrees\\a", cwd: "C:\\r\\.worktrees\\a" };
    const check = (cmd: string, r = roots, cwd = r.cwd) => sharedGitReason(cmd, r, cwd, none, path.win32, () => true);
    expect(check("git commit -m x")).toBe(
      `the main checkout is shared: commit inside C:\\r\\.worktrees\\<name>, then run bun repo worktree finish <name>`,
    );
    expect(check("git -C C:/r/packages stash")).toMatch(/^git stash in the main checkout /);
    expect(check("git -C 'C:\\r' reset --hard")).toMatch(/^git reset in the main checkout /);
    expect(check("git -C c:/R commit -m x")).toMatch(/^the main checkout is shared/);
    expect(check("cd .worktrees/a && git stash")).toBeNull();
    expect(check("git -C C:/r/.worktrees/a reset --hard")).toBeNull();
    expect(check("git -C 'C:\\r\\.worktrees\\a' commit --amend")).toBeNull();
    expect(check("git -C c:/R/.worktrees/a stash")).toBeNull();
    expect(check("git stash", inA)).toBeNull();
    expect(check("git -C C:/r commit -m x", inA)).toMatch(/^the main checkout is shared/);
    expect(check("git branch -D wt/b", inA)).toBeNull();
    expect(check("git worktree remove 'C:\r\.worktrees\b'", inA)).toBeNull();
    expect(check("git worktree remove ../b", inA)).toBeNull();
    expect(check("git worktree remove 'C:\\r\\.worktrees\\a'", inA)).toBeNull();
    expect(check("git push origin +main", inA)).toMatch(/^a force push rewrites shared history/);
    expect(check("git -C D:/other stash")).toBeNull();
  });
});

describe("mainCheckoutWriteReason", () => {
  const rootsOf = (r: string) => ({ root: r, checkout: r, cwd: r });

  it("denies a write into the main checkout and frees .tmp, worktrees and anything outside", () => {
    const r = repo();
    const roots = rootsOf(r);
    const reason = `the main checkout is shared: run bun repo worktree add <name> and write under ${path.join(r, ".worktrees", "<name>")}; only ${path.join(r, ".tmp")}${path.sep} is writable here`;
    expect(mainCheckoutWriteReason(path.join(r, "src/x.ts"), roots)).toBe(reason);
    expect(mainCheckoutWriteReason(path.join(r, ".repo/lessons/l.md"), roots)).toBe(reason);
    expect(mainCheckoutWriteReason("src/x.ts", roots)).toBe(reason);
    expect(mainCheckoutWriteReason(path.join(aliasOf(r), "src/x.ts"), roots)).toBe(reason);
    for (const free of [".tmp/repo/n.md", ".tmp", ".worktrees/a/src/x.ts", ".worktrees/a"]) {
      expect(mainCheckoutWriteReason(path.join(r, free), roots), free).toBeNull();
    }
    expect(mainCheckoutWriteReason(path.join(tmpDir("wt-out-"), "x.ts"), roots)).toBeNull();
  });

  it("passes outside a git repo and before the first commit", () => {
    const plain = tmpDir("wt-plain-");
    const unborn = tmpDir("wt-unborn-");
    git(unborn, "init", "-q", "-b", "main");
    for (const dir of [plain, unborn])
      expect(mainCheckoutWriteReason(path.join(dir, "src/x.ts"), rootsOf(dir))).toBeNull();
  });

  it("reads win32 spellings", () => {
    const roots = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r" };
    const check = (target: string) => mainCheckoutWriteReason(target, roots, path.win32, () => true);
    expect(check("C:\\r\\src\\x.ts")).toBe(
      "the main checkout is shared: run bun repo worktree add <name> and write under C:\\r\\.worktrees\\<name>; only C:\\r\\.tmp\\ is writable here",
    );
    expect(check("c:/R/src/x.ts")).toMatch(/^the main checkout is shared/);
    expect(check("src\\x.ts")).toMatch(/^the main checkout is shared/);
    for (const free of ["C:\\r\\.tmp\\repo\\n.md", "C:/r/.worktrees/a/src/x.ts", "D:\\other\\x.ts", "C:\\rr\\x.ts"])
      expect(check(free), free).toBeNull();
  });
});

describe("gitAskedWords", () => {
  it("finds whole words the user named, and nothing from everyday phrases", () => {
    expect(gitAskedWords("stash the main checkout")).toEqual(["stash"]);
    expect(gitAskedWords("STASH it")).toEqual(["stash"]);
    expect(gitAskedWords("I stashed it already")).toEqual([]);
    expect(gitAskedWords("git checkout main")).toEqual(["checkout"]);
    expect(gitAskedWords("clean up the code")).toEqual([]);
    expect(gitAskedWords("merge to main and switch to the main checkout")).toEqual([]);
    expect(gitAskedWords("/commit")).toEqual(["commit"]);
    expect(gitAskedWords("committed and pulled")).toEqual([]);
    expect(gitAskedWords("rebase onto main, then cherry-pick abc")).toEqual(
      expect.arrayContaining(["rebase", "cherry-pick"]),
    );
    expect(gitAskedWords("rebase onto main, then cherry-pick abc")).toHaveLength(2);
    for (const sub of [
      "switch",
      "restore",
      "clean",
      "reset",
      "merge",
      "pull",
      "revert",
      "am",
      "branch",
      "update-ref",
    ]) {
      expect(gitAskedWords(`please run git ${sub} now`), sub).toEqual([sub]);
    }
    for (const phrase of ["force push it", "do a force-push", "git push -f please", "git push --force"]) {
      expect(gitAskedWords(phrase), phrase).toContain("force");
    }
    expect(gitAskedWords("push it to origin")).toEqual([]);
    expect(gitAskedWords("")).toEqual([]);
  });
});

describe("managedLessonsDir", () => {
  it("names the lessons dir of the root or the managed worktree that holds the file", () => {
    const r = repo();
    const roots = { root: r, checkout: r, cwd: r };
    const lessons = (dir: string) => path.join(dir, ".repo", "lessons");
    expect(managedLessonsDir(path.join(r, "src/x.ts"), roots)).toBe(lessons(r));
    expect(managedLessonsDir(path.join(r, ".repo/lessons/l.md"), roots)).toBe(lessons(r));
    expect(managedLessonsDir(path.join(r, ".worktrees/a/src/x.ts"), roots)).toBe(lessons(wt(r, "a")));
    expect(managedLessonsDir(path.join(r, ".worktrees/a/.repo/lessons/l.md"), roots)).toBe(lessons(wt(r, "a")));
    expect(managedLessonsDir(path.join(aliasOf(r), "src/x.ts"), roots)).toBe(lessons(r));
    expect(managedLessonsDir(path.join(aliasOf(r), ".worktrees/a/x.ts"), roots)).toBe(lessons(wt(r, "a")));
    expect(managedLessonsDir("src/x.ts", roots)).toBe(lessons(r));
    expect(managedLessonsDir(path.join(tmpDir("wt-out-"), "x.ts"), roots)).toBeNull();
    expect(managedLessonsDir(`${r}-sibling/x.ts`, roots)).toBeNull();
  });

  it("reads win32 spellings", () => {
    const roots = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r" };
    expect(managedLessonsDir("C:\\r\\src\\x.ts", roots, path.win32)).toBe("C:\\r\\.repo\\lessons");
    expect(managedLessonsDir("c:/R/.worktrees/a/src/x.ts", roots, path.win32)).toBe(
      "C:\\r\\.worktrees\\a\\.repo\\lessons",
    );
    expect(managedLessonsDir("D:\\r\\x.ts", roots, path.win32)).toBeNull();
    expect(managedLessonsDir("C:\\rr\\x.ts", roots, path.win32)).toBeNull();
  });
});
