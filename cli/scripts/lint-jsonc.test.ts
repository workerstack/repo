import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanJsonDirs, ignoreConfig, jsonDir, readText } from "./__fixtures__/json-dirs.ts";
import { fmt } from "./lint.ts";

// fmt converts an own-line block comment in json with comments
afterEach(cleanJsonDirs);

const WITH = '{\n  /* base */\n  "strict": true\n}\n';
const DONE = '{\n  // base\n  "strict": true\n}\n';
const PLAIN = '{"b":1,"a":/* in */2}\n';

function tree() {
  return jsonDir({
    ".gitignore": ".oxfmtrc.jsonc\n",
    ".oxfmtrc.jsonc": ignoreConfig([]),
    ".oxlintrc.json": "{}\n",
    "__fixtures__/f.jsonc": WITH,
    "a.jsonc": WITH,
    "inline.jsonc": '{\n  "a": 1, /* kept */\n  "b": "/* kept */"\n}\n',
    "package.json": '{ "name": "app", "type": "module" }\n',
    "tsconfig.json": WITH,
    "workerstack.config.ts": 'export default { packs: ["standards"] };\n',
  });
}

function io() {
  const err: string[] = [];

  return { err, stderr: (s: string) => err.push(s) };
}

it("fmt rewrites it before the tool runs, and keeps inline, string and fixture comments", async () => {
  const root = tree();
  const calls: unknown[][] = [];

  function run(...args: unknown[]) {
    calls.push(args);

    return 0;
  }

  const o = io();
  const code = await fmt([], { cwd: root, run, stderr: o.stderr });
  expect([code, o.err]).toStrictEqual([0, []]);
  expect([readText(root, "a.jsonc"), readText(root, "tsconfig.json")]).toStrictEqual([DONE, DONE]);
  expect(readText(root, "inline.jsonc")).toContain("/* kept */");
  expect(readText(root, "__fixtures__/f.jsonc")).toBe(WITH);
  expect(calls).toStrictEqual([["bun fmt", [], root]]);
});

it("fmt --check names the file and line, exits 1 and writes nothing", async () => {
  const root = tree();
  const out = io();
  expect(await fmt(["--check"], { cwd: root, run: () => 0, stderr: out.stderr })).toBe(1);
  expect(out.err).toStrictEqual([
    "repo fmt: a.jsonc has an own-line /* */ comment at line 2; run `bun repo fmt`\n",
    "repo fmt: tsconfig.json has an own-line /* */ comment at line 2; run `bun repo fmt`\n",
  ]);
  expect(readText(root, "a.jsonc")).toBe(WITH);
});

it("fmt leaves plain json byte-equal and a path narrows the conversion", async () => {
  const root = tree();
  fs.writeFileSync(path.join(root, "plain.json"), PLAIN);
  expect(await fmt(["a.jsonc"], { cwd: root, run: () => 0, stderr: io().stderr })).toBe(0);
  expect([readText(root, "a.jsonc"), readText(root, "tsconfig.json"), readText(root, "plain.json")]).toStrictEqual([
    DONE,
    WITH,
    PLAIN,
  ]);
});
