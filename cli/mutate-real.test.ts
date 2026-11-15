import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { git, removePlanted, tempDir, write } from "./__fixtures__/planted-repo.ts";
import { childEnv } from "./env.ts";
import { realDeps } from "./mutate-real-deps.ts";
import { runMutate } from "./mutate.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { spawnSync } from "./spawn.ts";

afterEach(removePlanted);

const SLOW = 120_000;
const REPORT = ".repo/tmp/mutation/report.json";
const TOOL = "10.1.1";
const VITEST = "^5.1.0";

const MATH = [
  "export const add = (a: number, b: number): number => a + b;",
  "export const sub = (a: number, b: number): number => a - b;",
  "",
].join("\n");

const MATH_TEST = [
  'import { expect, it } from "vitest";',
  'import { add, sub } from "./math.ts";',
  'it("adds", () => expect(add(2, 3)).toBe(5));',
  'it("subtracts, weakly", () => expect(typeof sub(5, 3)).toBe("number"));',
  "",
].join("\n");

const STR = "export const shout = (text: string): string => text.toUpperCase();\n";

const STR_TEST = [
  'import { expect, it } from "vitest";',
  'import { shout } from "./str.ts";',
  'it("shouts", () => expect(shout("a")).toBe("A"));',
  "",
].join("\n");

/**
 * A pause that waits no time; its `Math.max` mutant waits `ms`, past Stryker's default 5 s mutant limit, which is how a
 * stalled machine slows any mutant. That mutant must survive, not count as a Timeout kill.
 */
const PAUSE = [
  "const SLOT = new Int32Array(new SharedArrayBuffer(4));",
  "export function pause(ms: number): void {",
  "  Atomics.wait(SLOT, 0, 0, Math.min(ms, 0));",
  "}",
  "",
].join("\n");

const PAUSE_TEST = [
  'import { expect, it } from "vitest";',
  'import { pause } from "./pause.ts";',
  'it("pauses", { timeout: 60_000 }, () => expect(pause(8_000)).toBeUndefined());',
  "",
].join("\n");

const MANIFEST = {
  devDependencies: { "@stryker-mutator/core": TOOL, "@stryker-mutator/vitest-runner": TOOL, vitest: VITEST },
  name: "planted",
  private: true,
  type: "module",
};

const TWICE = "export const twice = (n: number): number => n * 2;\n";

const TWICE_TEST = [
  'import { expect, it } from "vitest";',
  'import { twice } from "./twice.ts";',
  'it("doubles", () => expect(twice(3)).toBe(6));',
  "",
].join("\n");

/**
 * The PATH without the dirs where `bun --bun` puts its own `node`, which runs bun: the node run needs real node, as a
 * shell or CI finds it.
 */
function realNodePath(): string {
  const dirs = (childEnv()["PATH"] ?? "").split(path.delimiter);

  return dirs.filter((dir) => !path.basename(dir).startsWith("bun-node-")).join(path.delimiter);
}

/** A node config whose globalSetup throws under bun, so its tests pass only on node. */
const NODE_CONFIG = [
  'import { defineConfig } from "vitest/config";',
  'export default defineConfig({ test: { include: ["lint/**/*.test.ts"], coverage: { include: ["lint/**/*.ts"] },',
  '  globalSetup: ["./refuse-bun.ts"] } });',
  "",
].join("\n");

const REFUSE_BUN =
  'export function setup(): void { if (process.versions.bun !== undefined) throw new Error("bun"); }\n';

/** The three sources with a weak test and a slow mutant, mutated on bun. */
const BUN_SOURCES = {
  "src/math.test.ts": MATH_TEST,
  "src/math.ts": MATH,
  "src/pause.test.ts": PAUSE_TEST,
  "src/pause.ts": PAUSE,
  "src/str.test.ts": STR_TEST,
  "src/str.ts": STR,
};

/** One source on bun and one whose only test runs under the node config, which the main config leaves out. */
const NODE_SOURCES = {
  "lint/twice.test.ts": TWICE_TEST,
  "lint/twice.ts": TWICE,
  "refuse-bun.ts": REFUSE_BUN,
  "src/str.test.ts": STR_TEST,
  "src/str.ts": STR,
  "vitest.config.ts": 'export default { test: { exclude: ["lint/**", "node_modules/**"] } };\n',
  "vitest.node.config.ts": NODE_CONFIG,
};

/**
 * The sources, committed with a lockfile and no installed packages: `repo mutate` installs frozen in its own clone, so
 * a tree here would only cost a second install and its removal.
 */
function plantedRepo(sources: Record<string, string>, globs: readonly string[]): string {
  const dir = tempDir();
  const config = `export default { packs: [], coverage: { mutate: ${JSON.stringify(globs)} } };\n`;
  write(dir, {
    ".gitignore": "node_modules\n.repo/tmp/\n",
    "mutation-floors.json": { ".": 99 },
    "package.json": MANIFEST,
    "repo.config.ts": config,
    ...sources,
  });

  const installed = spawnSync(process.execPath, ["install", "--lockfile-only"], {
    cwd: dir,
    encoding: "utf8",
    env: toolEnv(childEnv()),
  });

  expect(installed.status, installed.stderr).toBe(0);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "planted");

  return dir;
}

type Scored = { files: Record<string, { killed: number; survivors: unknown[] }> };

type Report = { files: Record<string, { survivors: { line: number; mutator: string }[] }> };

/** `repo mutate` in `dir` on the real deps: its exit code, what it printed and the report text it wrote, if any. */
async function mutated(
  dir: string,
): Promise<{ code: number; printed: string; err: string; out: string; text: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const deps = { ...realDeps(dir), err: (t: string) => err.push(t), out: (t: string) => out.push(t) };
  const code = await runMutate([], deps);
  const report = path.join(dir, REPORT);
  const text = fs.existsSync(report) ? fs.readFileSync(report, "utf8") : "";

  return { code, err: err.join(""), out: out.join(""), printed: err.join("") + out.join(""), text };
}

function clones(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("workerstack-mutate-"));
}

it(
  "runs real Stryker through repo mutate: reports the weak test's and the slow mutant's survivors and score, " +
    "fails a floor above it, leaves the tree clean",
  { timeout: SLOW },
  async () => {
    const dir = plantedRepo(BUN_SOURCES, ["src/**/*.ts"]);
    const before = clones();
    const { code, err, out, printed, text } = await mutated(dir);
    expect(err, printed).toMatch(/^repo mutate: \. scored \d+\.\d\d%, below its floor of 99 in mutation-floors\.json/);
    expect(code).toBe(1);
    expect(out).toMatch(/mutate: 3 files, shard 1\/1\nmutate: \. \d+\.\d\d% \(floor 99\), 3 survivors in /);
    const report = JSON.parse(text) /* the shard report this command wrote */ as Report;

    function survivors(file: string) {
      return report.files[file]?.survivors.map((s) => [s.line, s.mutator]);
    }

    expect(survivors("src/math.ts")).toStrictEqual([[2, "ArithmeticOperator"]]);
    expect(survivors("src/pause.ts")).toStrictEqual([
      [2, "BlockStatement"],
      [3, "MethodExpression"],
    ]);
    expect(survivors("src/str.ts")).toStrictEqual([]);
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(clones()).toStrictEqual(before);
  },
);

it(
  "runs the files the node config covers in real Stryker on node, where its tests kill their mutants",
  { timeout: SLOW },
  async () => {
    const dir = plantedRepo(NODE_SOURCES, ["src/**/*.ts", "lint/**/*.ts"]);
    vi.stubEnv("PATH", realNodePath());
    const { code, printed, text } = await mutated(dir);
    expect(code, printed).toBe(0);
    const report = JSON.parse(text) /* the shard report this command wrote */ as Scored;
    expect(report.files["lint/twice.ts"]?.survivors).toStrictEqual([]);
    expect(report.files["lint/twice.ts"]?.killed).toBeGreaterThan(0);
    expect(report.files["src/str.ts"]?.survivors).toStrictEqual([]);
  },
);
