import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { childEnv } from "../env.ts";
import { cleanPlan } from "./clean-plan.ts";
import { liveSessions, runClean } from "./clean-run.ts";
import { nestedTmpDirs } from "./clean-scan.ts";
import { main } from "./clean.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 24 * 3600_000;

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "repo-clean-edges-")));
  dirs.push(dir);
  return dir;
}

function put(root: string, rel: string, body: string | Buffer) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const t = new Date(NOW - 2 * DAY);
  fs.utimesSync(file, t, t);
  return file;
}

function run(root: string, dryRun: boolean, rm?: typeof fs.rmSync) {
  const lines: string[] = [];
  const code = runClean({ dryRun, liveSessions: new Set(), now: NOW, out: (l) => lines.push(l), rm, root });
  return { code, lines };
}

describe("clean report", () => {
  it("sizes removed files in bytes, KB and MB", () => {
    const root = tempDir();
    put(root, ".tmp/repo/small.log", "x");
    expect(run(root, true).lines).toContain("would remove 1 file (1 B)");
    put(root, ".tmp/repo/mid.log", Buffer.alloc(2048));
    expect(run(root, true).lines.find((l) => l.startsWith("would remove"))).toMatch(/\(2\.0 KB\)$/);
    put(root, ".tmp/repo/big.log", Buffer.alloc(3 * 1024 * 1024));
    expect(run(root, true).lines.find((l) => l.startsWith("would remove"))).toMatch(/\(3\.0 MB\)$/);
  });

  it("reports a path it cannot remove, keeps going and exits 1", () => {
    const root = tempDir();
    put(root, ".tmp/repo/a.log", "a");
    put(root, ".tmp/repo/b.log", "b");
    const rm = ((p: string) => {
      if (p.endsWith("a.log")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      fs.rmSync(p, { force: true });
    }) /* the stand-in takes the path and options the report passes */ as typeof fs.rmSync;
    const { code, lines } = run(root, false, rm);
    expect(code).toBe(1);
    expect(lines).toContain("skipped .tmp/repo/a.log: EBUSY");
    expect(lines).toContain("removed 1 file (1 B)");
    expect(fs.existsSync(path.join(root, ".tmp/repo/a.log"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".tmp/repo/b.log"))).toBe(false);
  });
});

describe("cleanPlan", () => {
  it("plans without nested dirs by default", () => {
    const root = tempDir();
    put(root, ".tmp/repo/a.log", "a");
    expect(cleanPlan({ liveSessions: new Set(), now: NOW, root }).remove.map((r) => r.kind)).toStrictEqual(["file"]);
  });

  it("ignores a roadmaps entry that is not a readable file", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".tmp/repo/roadmaps/odd"), { recursive: true });
    put(root, ".tmp/repo/plans/1-a-20261103T000000Z.md", "---\nstatus: done\n---\n");
    expect(cleanPlan({ liveSessions: new Set(), now: NOW, root }).remove).toStrictEqual([]);
  });
});

describe("nested .tmp/repo", () => {
  it("finds a nested repo dir that git ignores as .tmp/repo", () => {
    const root = tempDir();
    execFileSync("git", ["init", "-q"], {
      cwd: root,
      env: childEnv({ GIT_DIR: undefined, GIT_INDEX_FILE: undefined }),
    });
    put(root, "pkg/.gitignore", ".tmp/repo/\n*.log\n");
    put(root, "pkg/skip.log", "x");
    put(root, "pkg/.tmp/repo/scratch.txt", "x");
    vi.stubEnv("GIT_DIR", undefined);
    vi.stubEnv("GIT_INDEX_FILE", undefined);
    put(root, "file-pkg/.gitignore", ".tmp/repo\n");
    put(root, "file-pkg/.tmp/repo", "a file, not a dir");
    put(root, "empty-pkg/.gitignore", ".tmp/\n");
    expect(nestedTmpDirs(root)).toStrictEqual([path.join(root, "pkg/.tmp/repo")]);
    const { lines } = run(root, false);
    expect(lines).toContain("removed 1 nested dir (1 B)");
    expect(fs.existsSync(path.join(root, "pkg/.tmp/repo"))).toBe(false);
  });
});

describe("main and liveSessions", () => {
  it("main cleans the working directory's root and prints to the console", () => {
    const root = tempDir();
    put(root, ".tmp/repo/a.log", "a");
    vi.spyOn(os, "homedir").mockReturnValue(root);
    vi.stubEnv("REPO_BOARD_HOME", root);
    vi.stubEnv("CLAUDE_PROJECT_DIR", undefined);
    vi.stubEnv("GROK_WORKSPACE_ROOT", undefined);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--dry-run"])).toBe(0);
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual([
      ".tmp/repo/a.log",
      "would remove 1 file (1 B)",
      "would keep nothing",
    ]);
    expect(fs.existsSync(path.join(root, ".tmp/repo/a.log"))).toBe(true);
  });

  it("liveSessions reads the board named by the environment", () => {
    const home = tempDir();
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("REPO_BOARD_HOME", home);
    expect(liveSessions()).toStrictEqual(new Set());
  });
});
