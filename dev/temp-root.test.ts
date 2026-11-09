import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnv } from "../cli/env.ts";

/** Each case plants a tiny vitest project that uses dev/temp-root.ts and runs the real vitest on it. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, "temp-root.ts");
const VITEST = path.join(HERE, "..", "node_modules", "vitest", "vitest.mjs");
const ROOT_PREFIX = "repo-test-";
const FAILED = 1;
const LEAK_LINE =
  /Error: tests left 1 entries in the run's temp root: leaked-dir; remove each in the test that made it/;

let parent = "";
let project = "";

beforeEach(() => {
  parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "temp-root-test-")));
  project = path.join(parent, "project");
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(parent, "tmp"));
});

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true });
});

const runsDir = () => path.join(parent, "tmp");
const roots = () => fs.readdirSync(runsDir()).filter((name) => name.startsWith(ROOT_PREFIX));

/** Plants a project whose one test runs `body`, then runs vitest on it with TMPDIR at the parent's tmp dir. */
function run(body: string, env: Record<string, string | undefined> = {}): SpawnSyncReturns<string> {
  const config = `export default { test: { globals: true, globalSetup: [${JSON.stringify(GUARD)}], server: { deps: { inline: ["zod"] } } } };\n`;
  fs.writeFileSync(path.join(project, "vitest.config.mjs"), config);
  fs.writeFileSync(
    path.join(project, "a.test.mjs"),
    `import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\nit("runs", () => {\n${body}\n});\n`,
  );
  const overrides = {
    TMPDIR: runsDir(),
    TEMP: runsDir(),
    TMP: runsDir(),
    REPO_E2E_KEEP: undefined,
    NO_COLOR: "1",
    FORCE_COLOR: undefined,
    ...env,
  };
  return spawnSync("bun", ["--bun", VITEST, "run"], { cwd: project, env: childEnv(overrides), encoding: "utf8" });
}

const LEAK = `fs.mkdirSync(path.join(os.tmpdir(), "leaked-dir"));`;
const CLEAN = `expect(1).toBe(1);`;

describe("temp root guard", () => {
  it("fails a run whose test leaves a dir, says which, and removes the root", () => {
    const r = run(LEAK);
    expect(r.status).toBe(FAILED);
    expect(r.stdout + r.stderr).toMatch(LEAK_LINE);
    expect(roots()).toEqual([]);
  });

  it("passes a clean run and removes the root", () => {
    const r = run(CLEAN);
    expect(r.status).toBe(0);
    expect(roots()).toEqual([]);
  });
});

describe("temp root guard, the root", () => {
  it("gives a worker the run root as os.tmpdir()", () => {
    const pattern = `^${ROOT_PREFIX}\\d+-`;
    const body = `expect(path.dirname(fs.realpathSync(os.tmpdir()))).toBe(${JSON.stringify(runsDir())});
expect(path.basename(os.tmpdir())).toMatch(new RegExp(${JSON.stringify(pattern)}));`;
    const r = run(body);
    expect(r.stdout + r.stderr).not.toMatch(/AssertionError/);
    expect(r.status).toBe(0);
  });

  it("removes the root of a dead run at start and keeps a live one's", () => {
    const dead = spawnSync("bun", ["-e", ""]).pid;
    const stale = path.join(runsDir(), `${ROOT_PREFIX}${dead}-abc123`);
    const live = path.join(runsDir(), `${ROOT_PREFIX}${process.pid}-abc123`);
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
    expect(kept).toMatch(new RegExp(`^${ROOT_PREFIX}\\d+-`));
    expect(r.stdout + r.stderr).toContain(`kept temp root: ${path.join(runsDir(), kept ?? "")}`);
    expect(fs.existsSync(path.join(runsDir(), kept ?? "", "leaked-dir"))).toBe(true);
  });
});
