import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { childEnv } from "../cli/env.ts";

/** Each case plants a tiny vitest project that uses presets/temp-root.ts and runs the real vitest on it. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, "temp-root.ts");
const ENV_MODULE = path.join(HERE, "temp-root-env.ts");
const VITEST = path.join(HERE, "..", "node_modules", "vitest", "vitest.mjs");
const ROOT_PREFIX = "repo-test-";
const CHILD =
  `spawnSync("bun", ["-e", 'require("fs").writeFileSync(` +
  `require("path").join(require("os").tmpdir(), "child-leak"), "")']);`;
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

function runsDir() {
  return path.join(parent, "tmp");
}
function roots() {
  return fs.readdirSync(runsDir()).filter((name) => name.startsWith(ROOT_PREFIX));
}

/** The imports the planted test file starts with. */
const TEST_IMPORTS = [
  'import fs from "node:fs";',
  'import { spawnSync } from "node:child_process";',
  'import os from "node:os";',
  'import path from "node:path";',
  "",
].join("\n");

/** Plants a project whose one test runs `body`, then runs vitest on it with TMPDIR at the parent's tmp dir. */
function run(body: string, env: Record<string, string | undefined> = {}): SpawnSyncReturns<string> {
  const config =
    `import { rootEnv } from ${JSON.stringify(ENV_MODULE)};\n` +
    `export default { test: { globals: true, env: rootEnv(), ` +
    `globalSetup: [${JSON.stringify(GUARD)}, ...(process.env.PROBE ? [process.env.PROBE] : [])], ` +
    `server: { deps: { inline: ["zod"] } } } };\n`;
  fs.writeFileSync(path.join(project, "vitest.config.mjs"), config);
  fs.writeFileSync(path.join(project, "a.test.mjs"), `${TEST_IMPORTS}it("runs", () => {\n${body}\n});\n`);
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
      [
        'import fs from "node:fs";',
        'import os from "node:os";',
        "export default () => {",
        '  fs.mkdirSync(os.tmpdir() + "/miniflare-main");',
        `  fs.writeFileSync(${JSON.stringify(probe)}, os.tmpdir());`,
        '  return () => fs.rmSync(os.tmpdir() + "/miniflare-main", { recursive: true });',
        "};",
        "",
      ].join("\n"),
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
