import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { childEnv } from "../env.ts";
import { plantStub } from "../fixtures/stub-bin.ts";
import { loadOptionalConsumerEnv, main, runDoctor, workspaceIssues } from "./doctor.ts";

const REAL_PLATFORM = Object.getOwnPropertyDescriptor(
  process,
  "platform",
) /* process always has platform */ as PropertyDescriptor;
const dirs: string[] = [];
afterEach(() => {
  Object.defineProperty(process, "platform", REAL_PLATFORM);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doc-run-")));
  dirs.push(dir);
  return dir;
}

function put(root: string, rel: string, body: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function plantBin(dir: string, name: string, body: string) {
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

/** Process state a planted run needs: a planted cwd and home, and no inherited repo or root pointers. */
function isolate(cwd = tmp()) {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.spyOn(os, "homedir").mockReturnValue(tmp());
  for (const key of ["GIT_DIR", "GIT_INDEX_FILE", "CLAUDE_PROJECT_DIR", "GROK_WORKSPACE_ROOT"])
    vi.stubEnv(key, undefined);

  return cwd;
}

describe("runDoctor", () => {
  it("reads the process cwd, PATH, platform, env and home by default", () => {
    isolate();
    const res = runDoctor();
    expect(res.stdout).toMatch(/^bun\s/);
    expect(res.stdout).toMatch(/workspace\s+ok/);
    expect(res.stderr).toBe("");
  });

  it("reports a bun that is on PATH but does not run", () => {
    const bin = tmp();
    const planted = plantStub(bin, "bun", { cmd: "exit /b 1\n", sh: "exit 1\n" });
    const res = runDoctor({ cwd: tmp(), env: {}, home: tmp(), pathEnv: bin, platform: "linux" });
    const escaped = planted.replaceAll(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
    expect(res.stdout).toMatch(new RegExp(`bun\\s+need ≥\\S+\\s+unknown \\(${escaped}\\)`));
    expect(res.code).toBe(1);
  });

  it("runs a .cmd bun through the shell on a Windows host and joins PATH with semicolons", () => {
    Object.defineProperty(process, "platform", { ...REAL_PLATFORM, value: "win32" });
    const bin = tmp();
    plantBin(bin, "bun.cmd", "#!/bin/sh\necho 9.9.9\n");
    const res = runDoctor({ cwd: tmp(), env: {}, home: tmp(), pathEnv: `${bin};${tmp()}`, platform: "win32" });
    expect(res.stdout).toContain("9.9.9");
  });

  it("prints each missing tool's install hints once", () => {
    const res = runDoctor({ cwd: tmp(), env: {}, home: tmp(), pathEnv: tmp(), platform: "linux" });
    const hints = (res.stdout.split("install (print-only; not run):\n")[1] ?? "").split("\n");
    expect(hints).toContain("sudo apt install git");
    expect(new Set(hints.slice(0, 8)).size).toBe(8);
  });
});

describe("main and the consumer env", () => {
  it("has no consumer env script in this package", async () => {
    expect(await loadOptionalConsumerEnv()).toBe(false);
  });

  it("prints the doctor report and returns its exit code", async () => {
    const bin = tmp();
    plantBin(bin, "grok", '#!/bin/sh\necho "Available models:"\necho "  grok-4.7"\n');
    isolate();
    vi.stubEnv("PATH", bin);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main();
    expect(code).toBe(1);
    const out = write.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/^bun\s+missing/);
    expect(out).toMatch(/agent models\s/);
  });
});

// Each case builds its own repo; git runs with the pointers a hook leaves behind cleared.
const gitEnv = childEnv({
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_AUTHOR_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_DIR: undefined,
  GIT_INDEX_FILE: undefined,
});
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });

function repo() {
  const r = tmp();
  git(r, "init", "-q", "-b", "main");
  put(r, "README.md", "x\n");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "init");
  vi.stubEnv("GIT_DIR", undefined);
  vi.stubEnv("GIT_INDEX_FILE", undefined);
  return r;
}

describe("workspaceIssues on thin repos", () => {
  it("reports nothing for a repo with no root .gitignore and a comment-only nested one", () => {
    const r = repo();
    put(r, "pkg/.gitignore", "# nothing yet\n\n");
    expect(workspaceIssues({ checkout: r, root: r })).toStrictEqual([]);
  });

  it("reports nothing when git cannot list the files", () => {
    const r = repo();
    fs.writeFileSync(path.join(r, ".git", "index"), "garbage");
    expect(workspaceIssues({ checkout: r, root: r })).toStrictEqual([]);
  });

  it("labels a detached worktree outside .worktrees", () => {
    const r = repo();
    const outside = `${r}-detached`;
    dirs.push(outside);
    git(r, "worktree", "add", "-q", "--detach", outside);
    const items = workspaceIssues({ checkout: r, root: r });
    expect(items).toStrictEqual([
      {
        clear: `git -C ${r} worktree remove ${fs.realpathSync(outside)}`,
        detail: "detached",
        kind: "worktree outside .worktrees",
        path: fs.realpathSync(outside),
      },
    ]);
  });
});
