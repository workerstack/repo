import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { childEnv } from "./env.ts";
import { git, removePlanted, tempDir, write } from "./fixtures/planted-repo.ts";
import { runMutate } from "./mutate.ts";
import { realDeps } from "./mutate-real-deps.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { spawnSync } from "./spawn.ts";

afterEach(removePlanted);

const SLOW = 120_000;
const REPORT = ".tmp/repo/mutation/report.json";
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

/** Two sources and one weak test, committed with an installed lockfile, so a clone installs frozen from bun's cache. */
function plantedRepo(): string {
  const dir = tempDir();
  const manifest = {
    name: "planted",
    private: true,
    type: "module",
    devDependencies: {
      vitest: VITEST,
      "@stryker-mutator/core": TOOL,
      "@stryker-mutator/vitest-runner": TOOL,
    },
  };
  write(dir, {
    "package.json": manifest,
    ".gitignore": "node_modules\n.tmp/\n",
    "workerstack.config.ts": 'export default { packs: [], coverage: { mutate: ["src/**/*.ts"] } };\n',
    "mutation-floors.json": { ".": 99 },
    "src/math.ts": MATH,
    "src/math.test.ts": MATH_TEST,
    "src/str.ts": STR,
    "src/str.test.ts": STR_TEST,
  });
  const installed = spawnSync(process.execPath, ["install"], { cwd: dir, encoding: "utf8", env: toolEnv(childEnv()) });
  expect(installed.status, installed.stderr).toBe(0);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "planted");
  return dir;
}

type Report = { files: Record<string, { survivors: { line: number; mutator: string }[] }> };

const clones = (): string[] => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("workerstack-mutate-"));

it(
  "runs real Stryker through repo mutate: reports the weak test's survivor and score, fails a floor above it, leaves the tree clean",
  { timeout: SLOW },
  async () => {
    const dir = plantedRepo();
    const before = clones();
    const out: string[] = [];
    const err: string[] = [];
    const deps = { ...realDeps(dir), out: (t: string) => out.push(t), err: (t: string) => err.push(t) };
    const code = await runMutate([], deps);
    expect(err.join(""), out.join("")).toMatch(
      /^repo mutate: \. scored \d+\.\d\d%, below its floor of 99 in mutation-floors\.json/,
    );
    expect(code).toBe(1);
    expect(out.join("")).toMatch(/mutate: 2 files, shard 1\/1\nmutate: \. \d+\.\d\d% \(floor 99\), 1 survivor in /);
    const text = fs.readFileSync(path.join(dir, REPORT), "utf8");
    const report = JSON.parse(text) /* the shard report this command wrote */ as Report;
    const survivors = (file: string) => report.files[file]?.survivors.map((s) => [s.line, s.mutator]);
    expect(survivors("src/math.ts")).toStrictEqual([[2, "ArithmeticOperator"]]);
    expect(survivors("src/str.ts")).toStrictEqual([]);
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(clones()).toStrictEqual(before);
  },
);
