import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { childEnv } from "../cli/env.ts";
import { rootPath } from "./temp-root-env.ts";
import { setup } from "./temp-root.ts";

/** Each case plants a tiny vitest project that uses presets/temp-root.ts and runs the real vitest on it. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, "temp-root.ts");
const ENV_MODULE = path.join(HERE, "temp-root-env.ts");
const VITEST = path.join(HERE, "..", "node_modules", "vitest", "vitest.mjs");
const ROOT_PREFIX = "repo-test-";
const CHILD = `spawnSync("bun", ["-e", 'require("fs").writeFileSync(require("path").join(require("os").tmpdir(), "child-leak"), "")']);`;
const FAILED = 1;
const LEAK_LINE = /Error: tests left 1 entry in the run's temp root: leaked-dir; remove each in the test that made it/;

let parent = "";
let project = "";

beforeEach(() => {
  parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "temp-root-test-")));
  project = path.join(parent, "project");
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(parent, "tmp"));
});

afterEach(() => {
  fs.rmSync(parent, { force: true, recursive: true });
});

const runsDir = () => path.join(parent, "tmp");
const roots = () => fs.readdirSync(runsDir()).filter((name) => name.startsWith(ROOT_PREFIX));

/** Plants a project whose one test runs `body`, then runs vitest on it with TMPDIR at the parent's tmp dir. */
function run(body: string, env: Record<string, string | undefined> = {}): SpawnSyncReturns<string> {
  const config = `import { rootEnv } from ${JSON.stringify(ENV_MODULE)};\nexport default { test: { globals: true, env: rootEnv(), globalSetup: [${JSON.stringify(GUARD)}, ...(process.env.PROBE ? [process.env.PROBE] : [])], server: { deps: { inline: ["zod"] } } } };\n`;
  fs.writeFileSync(path.join(project, "vitest.config.mjs"), config);
  fs.writeFileSync(
    path.join(project, "a.test.mjs"),
    `import fs from "node:fs";\nimport { spawnSync } from "node:child_process";\nimport os from "node:os";\nimport path from "node:path";\nit("runs", () => {\n${body}\n});\n`,
  );
  const overrides = {
    FORCE_COLOR: undefined,
    NO_COLOR: "1",
    REPO_E2E_KEEP: undefined,
    TEMP: runsDir(),
    TMP: runsDir(),
    TMPDIR: runsDir(),
    ...env,
  };
  return spawnSync("bun", ["--bun", VITEST, "run"], { cwd: project, encoding: "utf8", env: childEnv(overrides) });
}

const LEAK = `fs.mkdirSync(path.join(os.tmpdir(), "leaked-dir"));`;
const CLEAN = `expect(1).toBe(1);`;

describe("temp root guard", () => {
  it("fails a run whose test leaves a dir, says which, and removes the root", () => {
    const r = run(LEAK);
    expect(r.status).toBe(FAILED);
    expect(r.stdout + r.stderr).toMatch(LEAK_LINE);
    expect(roots()).toStrictEqual([]);
  });

  it("passes a clean run and removes the root", () => {
    const r = run(CLEAN);
    expect(r.status).toBe(0);
    expect(roots()).toStrictEqual([]);
  });
});

describe("temp root guard, who gets the root", () => {
  it("fails a run whose test spawns a child that leaves a file in its temp dir", () => {
    const r = run(`${CHILD}\nexpect(1).toBe(1);`);
    expect(r.status).toBe(FAILED);
    expect(r.stdout + r.stderr).toContain("tests left 1 entry in the run's temp root: child-leak;");
    expect(roots()).toStrictEqual([]);
  });

  it("leaves the runner's own temp dir alone, so its tooling's temp dirs are not leaks", () => {
    const probe = path.join(project, "probe.txt");
    const setupFile = path.join(project, "probe.mjs");
    fs.writeFileSync(
      setupFile,
      `import fs from "node:fs";\nimport os from "node:os";\nexport default () => {\n  fs.mkdirSync(os.tmpdir() + "/miniflare-main");\n  fs.writeFileSync(${JSON.stringify(probe)}, os.tmpdir());\n  return () => fs.rmSync(os.tmpdir() + "/miniflare-main", { recursive: true });\n};\n`,
    );
    const r = run(CLEAN, { PROBE: setupFile });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe(runsDir());
  });
});

describe("temp root guard, the root", () => {
  it("gives a worker the run root as os.tmpdir()", () => {
    const pattern = `^${ROOT_PREFIX}\\d+$`;
    const body = `expect(path.dirname(fs.realpathSync(os.tmpdir()))).toBe(${JSON.stringify(runsDir())});
expect(path.basename(os.tmpdir())).toMatch(new RegExp(${JSON.stringify(pattern)}));`;
    const r = run(body);
    expect(r.stdout + r.stderr).not.toMatch(/AssertionError/);
    expect(r.status).toBe(0);
  });

  it("removes the root of a dead run at start and keeps a live one's", () => {
    const dead = spawnSync("bun", ["-e", ""]).pid;
    const stale = path.join(runsDir(), `${ROOT_PREFIX}${dead}`);
    const live = path.join(runsDir(), `${ROOT_PREFIX}${process.pid}`);
    for (const dir of [stale, live]) fs.mkdirSync(path.join(dir, "inner"), { recursive: true });
    const r = run(CLEAN);
    expect(r.status).toBe(0);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
    expect(r.stdout + r.stderr).not.toContain(path.basename(stale));
  });

  it("keeps the root and passes under REPO_E2E_KEEP, printing its path", () => {
    const r = run(LEAK, { REPO_E2E_KEEP: "1" });
    expect(r.status).toBe(0);
    const [kept] = roots();
    expect(kept).toMatch(new RegExp(`^${ROOT_PREFIX}\\d+$`));
    expect(r.stdout + r.stderr).toContain(`kept temp root: ${path.join(runsDir(), kept ?? "")}`);
    expect(fs.existsSync(path.join(runsDir(), kept ?? "", "leaked-dir"))).toBe(true);
  });
});

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

const envOf = (name: string) => childEnv()[name];

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
    expect(fs.readdirSync(runsDir()).sort()).toStrictEqual(names.slice(1).sort());
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
