import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { CMD_BODY } from "./shim.constants.ts";
import { parseArgv, runShim, shimDir } from "./shim.ts";

useTempDirs();

const SOURCE = '#!/usr/bin/env bun\nconsole.log("repo");\n';

type Opts = { argv?: string[]; platform?: NodeJS.Platform; pathEnv?: string; home?: string };

function shim(dir: string, o: Opts = {}) {
  return runShim({
    argv: ["--dir", dir, ...(o.argv ?? [])],
    home: o.home ?? tempDir("shim-home-"),
    pathEnv: o.pathEnv ?? dir,
    platform: o.platform ?? "linux",
    source: SOURCE,
  });
}

function read(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), "utf8");
}

describe("parseArgv", () => {
  it("reads the flags and rejects the rest", () => {
    expect(parseArgv(["--check", "--dir", "x"])).toStrictEqual({ check: true, dir: "x", dryRun: false, ok: true });
    expect(parseArgv(["--dry-run", "--dir=y"])).toStrictEqual({ check: false, dir: "y", dryRun: true, ok: true });
    expect(parseArgv(["--nope"])).toStrictEqual({ error: "unknown flag: --nope", ok: false });
    expect(parseArgv(["--dir"])).toStrictEqual({ error: "--dir needs a path", ok: false });
    expect(parseArgv(["--check", "--dry-run"])).toStrictEqual({
      error: "--check and --dry-run do not combine",
      ok: false,
    });
  });
});

describe("shimDir", () => {
  it("is ~/.local/bin on POSIX and %LOCALAPPDATA%\\workerstack\\bin on Windows", () => {
    expect(shimDir({ home: path.join("h", "u"), platform: "linux" })).toBe(path.join("h", "u", ".local", "bin"));
    expect(shimDir({ home: "h", localAppData: path.join("L", "A"), platform: "win32" })).toBe(
      path.join("L", "A", "workerstack", "bin"),
    );
    expect(shimDir({ home: "h", platform: "win32" })).toBe(path.join("h", "AppData", "Local", "workerstack", "bin"));
  });
});

describe("install", () => {
  it("writes the launcher with LF endings and reports an apply row", () => {
    const dir = path.join(tempDir("shim-new-"), "bin");
    const r = shim(dir);

    expect(r.code).toBe(0);
    expect(r.out).toStrictEqual([`apply shim ${path.join(dir, "repo")}`]);
    expect(read(dir, "repo")).toBe(SOURCE);
    expect(fs.readdirSync(dir)).toStrictEqual(["repo"]);
  });

  it("normalizes a CRLF source to LF so the shebang survives", () => {
    const dir = tempDir("shim-crlf-");
    const source = SOURCE.replaceAll("\n", "\r\n");
    runShim({ argv: ["--dir", dir], home: dir, pathEnv: dir, platform: "linux", source });

    expect(read(dir, "repo")).toBe(SOURCE);
  });

  it.runIf(process.platform !== "win32")("makes the launcher executable", () => {
    const dir = tempDir("shim-mode-");
    shim(dir);

    expect(fs.statSync(path.join(dir, "repo")).mode & 0o111).toBe(0o111);
  });
});

describe("install on Windows", () => {
  it("also writes repo.mjs and a CRLF repo.cmd", () => {
    const dir = tempDir("shim-win-");
    const r = shim(dir, { platform: "win32" });

    expect(r.out).toStrictEqual(["repo", "repo.mjs", "repo.cmd"].map((n) => `apply shim ${path.join(dir, n)}`));
    expect(read(dir, "repo.mjs")).toBe(SOURCE);
    expect(read(dir, "repo.cmd")).toBe(CMD_BODY);
    expect(read(dir, "repo.cmd")).toContain("\r\n");
  });
});

describe("install again", () => {
  it("a second run changes nothing", () => {
    const dir = tempDir("shim-twice-");
    shim(dir);
    const before = fs.statSync(path.join(dir, "repo")).mtimeMs;
    const r = shim(dir);

    expect(r.out).toStrictEqual([`ok shim ${path.join(dir, "repo")}`]);
    expect(fs.statSync(path.join(dir, "repo")).mtimeMs).toBe(before);
  });

  it("rewrites a stale launcher", () => {
    const dir = tempDir("shim-stale-");
    fs.writeFileSync(path.join(dir, "repo"), "old\n");

    expect(shim(dir).out).toStrictEqual([`apply shim ${path.join(dir, "repo")}`]);
    expect(read(dir, "repo")).toBe(SOURCE);
  });

  it("--dry-run writes nothing and says what it would write", () => {
    const dir = path.join(tempDir("shim-dry-"), "bin");
    const r = shim(dir, { argv: ["--dry-run"] });

    expect(r.out).toStrictEqual([`dry-run shim ${path.join(dir, "repo")}`]);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("--check", () => {
  it("is ok after an install", () => {
    const dir = tempDir("shim-chk-ok-");
    shim(dir);

    expect(shim(dir, { argv: ["--check"] })).toMatchObject({ code: 0, out: ["shim ok"] });
  });

  it("exits 1 on a missing and on a stale file, naming it", () => {
    const dir = tempDir("shim-chk-bad-");

    expect(shim(dir, { argv: ["--check"] })).toMatchObject({
      code: 1,
      out: ["shim drift: repo is missing (run repo shim)"],
    });
    fs.writeFileSync(path.join(dir, "repo"), "old\n");
    expect(shim(dir, { argv: ["--check"] }).out).toStrictEqual(["shim drift: repo is stale (run repo shim)"]);
  });
});

describe("the PATH hint", () => {
  it("is silent when the dir is on PATH", () => {
    const dir = tempDir("shim-path-on-");

    expect(shim(dir, { pathEnv: ["/usr/bin", dir].join(path.delimiter) }).out).toHaveLength(1);
  });

  it("names the export and fish lines on POSIX when the dir is off PATH", () => {
    const dir = tempDir("shim-path-off-");
    const out = shim(dir, { pathEnv: "/usr/bin" }).out.join("\n");

    expect(out).toContain(`export PATH="${dir}:$PATH"`);
    expect(out).toContain(`fish_add_path ${dir}`);
  });

  it("names the PowerShell line on Windows when the dir is off PATH", () => {
    const dir = tempDir("shim-path-win-");
    const out = shim(dir, { pathEnv: "C:\\Windows", platform: "win32" }).out.join("\n");

    expect(out).toContain("[Environment]::SetEnvironmentVariable");
    expect(out).toContain(dir);
  });
});
