import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../cli/__fixtures__/temp-dirs.ts";
import { childEnv } from "../cli/env.ts";
import { byCodeUnit } from "../cli/sync/by-code-unit.ts";
import { rootPath } from "./temp-root-env.ts";
import { ROOT_PREFIX } from "./temp-root.constants.ts";
import { setup } from "./temp-root.ts";

/** The guard in this process: setup and teardown called directly, the temp variables at the test's own dir. */
const FAILED = 1;
const { tempDir } = useTempDirs("temp-root-test-");
let runs = "";

beforeEach(() => {
  runs = path.join(fs.realpathSync(tempDir()), "tmp");
  fs.mkdirSync(runs);
});

function runsDir() {
  return runs;
}

function roots() {
  return fs.readdirSync(runsDir()).filter((name) => name.startsWith(ROOT_PREFIX));
}

/** The captured stdout and stderr writes of an in-process run; the temp variables point at the test's own dir. */
type Captured = { out: string[]; err: string[] };

/** Registers the hooks every in-process case needs and returns the writes they capture. */
function captureRun(): Captured {
  const exitCode = process.exitCode;
  const captured: Captured = { err: [], out: [] };
  beforeEach(() => {
    for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, runsDir());
    vi.stubEnv("REPO_E2E_KEEP", undefined);
    vi.stubEnv("NODE_COMPILE_CACHE", undefined);
    process.exitCode = 0;
    captured.out = [];
    captured.err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((text) => captured.out.push(String(text)) > 0);
    vi.spyOn(process.stderr, "write").mockImplementation((text) => captured.err.push(String(text)) > 0);
  });
  afterEach(() => {
    process.exitCode = exitCode ?? 0;
    vi.restoreAllMocks();
  });

  return captured;
}

function envOf(name: string) {
  return childEnv()[name];
}

describe("temp root guard, in process, the root", () => {
  captureRun();

  it("makes the run root named by the pid, and leaves this process's temp variables alone", () => {
    const teardown = setup();
    expect(roots()).toStrictEqual([`${ROOT_PREFIX}${process.pid}`]);

    for (const name of ["TMPDIR", "TEMP", "TMP"]) expect(envOf(name)).toBe(runsDir());
    teardown();
    expect(roots()).toStrictEqual([]);
  });

  it("replaces a stale root left by an earlier process with the same pid", () => {
    fs.mkdirSync(path.join(rootPath(), "old"), { recursive: true });
    setup()();
    expect(process.exitCode).toBe(0);
    expect(roots()).toStrictEqual([]);
  });

  it("removes the roots of dead runs, and keeps live ones, ones it cannot signal and other names", () => {
    const dead = spawnSync("bun", ["-e", ""]).pid;
    // Pid 1 is a root this user cannot signal on posix; Windows has no pid 1, so no run is left to keep there.
    const unsignalable = process.platform === "win32" ? [] : [`${ROOT_PREFIX}1`];
    const names = [`${ROOT_PREFIX}${dead}`, `${ROOT_PREFIX}${process.ppid}`, ...unsignalable, "unrelated"];

    for (const name of names) fs.mkdirSync(path.join(runsDir(), name));
    setup()();
    expect(fs.readdirSync(runsDir()).toSorted(byCodeUnit)).toStrictEqual(names.slice(1).toSorted(byCodeUnit));
  });
});

describe("temp root guard, in process, the verdict", () => {
  const captured = captureRun();

  it("passes a clean run: the root goes and the exit code stays", () => {
    setup()();
    expect(roots()).toStrictEqual([]);
    expect(process.exitCode).toBe(0);
    expect(captured.err).toStrictEqual([]);
  });

  it("fails a run that left one entry and says `entry`", () => {
    const teardown = setup();
    fs.mkdirSync(path.join(rootPath(), "x"));
    teardown();
    expect(process.exitCode).toBe(FAILED);
    expect(captured.err.join("")).toBe(
      "Error: tests left 1 entry in the run's temp root: x; remove each in the test that made it\n",
    );
    expect(roots()).toStrictEqual([]);
  });

  it("fails a run that left several entries and lists them sorted under `entries`", () => {
    const teardown = setup();

    for (const name of ["b", "a"]) fs.writeFileSync(path.join(rootPath(), name), "");
    teardown();
    expect(process.exitCode).toBe(FAILED);
    expect(captured.err.join("")).toBe(
      "Error: tests left 2 entries in the run's temp root: a, b; remove each in the test that made it\n",
    );
  });
});

describe("temp root guard, in process, the keep", () => {
  const captured = captureRun();

  it("keeps the root under REPO_E2E_KEEP, names it and does not fail", () => {
    vi.stubEnv("REPO_E2E_KEEP", "1");
    const teardown = setup();
    fs.writeFileSync(path.join(rootPath(), "kept"), "");
    teardown();
    const [kept] = roots();
    expect(process.exitCode).toBe(0);
    expect(captured.out.join("")).toBe(`kept temp root: ${path.join(runsDir(), kept ?? "")}\n`);
    expect(fs.existsSync(path.join(runsDir(), kept ?? "", "kept"))).toBe(true);
  });
});
