import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { removePlanted, tempDir } from "./__fixtures__/planted-repo.ts";
import { checkActionlintAt, type Spawn } from "./actionlint.ts";
import { childEnv } from "./env.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  removePlanted();
});

const EXE = process.platform === "win32" ? "actionlint.exe" : "actionlint";

type Call = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

let calls: Call[] = [];

beforeEach(() => {
  calls = [];
});

function answering(code: number, stdout: string, stderr = ""): Spawn {
  return (command, args, options) => {
    calls.push({ args, command, ...options });

    return { code, stderr, stdout };
  };
}

function failFetch() {
  return Promise.reject(new Error("the cache should have been used"));
}

/** A repo with a config of `packs`, the workflow files named, and a cached binary. */
function repo(packs: string, workflows: string[]) {
  const root = tempDir();
  const cacheDir = tempDir();
  fs.writeFileSync(path.join(cacheDir, EXE), "binary");
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), `export default { packs: ${packs} };\n`);
  const flows = path.join(root, ".github", "workflows");
  fs.mkdirSync(flows, { recursive: true });

  for (const name of workflows) fs.writeFileSync(path.join(flows, name), "name: x\n");

  return { cacheDir, root };
}

it("runs nothing without a config, without a workflow pack or without a workflow", async () => {
  const bare = tempDir();
  const spawn = answering(0, "");
  expect(await checkActionlintAt(bare, { fetch: failFetch, spawn })).toStrictEqual({ problems: [] });
  const off = repo('["standards"]', ["ci.yml"]);
  expect(await checkActionlintAt(off.root, { cacheDir: off.cacheDir, fetch: failFetch, spawn })).toStrictEqual({
    problems: [],
  });
  const none = repo('["release"]', ["notes.txt"]);
  fs.rmSync(path.join(none.root, ".github", "workflows", "notes.txt"));
  expect(await checkActionlintAt(none.root, { cacheDir: none.cacheDir, fetch: failFetch, spawn })).toStrictEqual({
    problems: [],
  });
  fs.rmSync(path.join(none.root, ".github"), { recursive: true });
  expect(await checkActionlintAt(none.root, { cacheDir: none.cacheDir, fetch: failFetch, spawn })).toStrictEqual({
    problems: [],
  });
  expect(calls).toStrictEqual([]);
});

it("lints every .yml and .yaml workflow with the cached binary, in the repo root, and nothing else", async () => {
  vi.stubEnv("GIT_DIR", "/elsewhere");
  const { root, cacheDir } = repo('["release"]', ["b.yaml", "a.yml", "notes.txt"]);
  const out = await checkActionlintAt(root, { cacheDir, fetch: failFetch, spawn: answering(0, "[]") });
  expect(out).toStrictEqual({ problems: [] });
  expect(calls).toHaveLength(1);
  const [call] = calls;
  expect(call?.command).toBe(path.join(cacheDir, EXE));
  expect(call?.args).toStrictEqual([
    "-format",
    "{{json .}}",
    "-shellcheck=",
    "-pyflakes=",
    ".github/workflows/a.yml",
    ".github/workflows/b.yaml",
  ]);
  expect(call?.cwd).toBe(root);
  expect(call?.env.PATH).toBe(childEnv().PATH);
  expect(call?.env.GIT_DIR).toBeUndefined();
});

it("lints the workflows under the benchmark pack alone, which generates bench.yml", async () => {
  const { root, cacheDir } = repo('["benchmark"]', ["bench.yml"]);
  const out = await checkActionlintAt(root, { cacheDir, fetch: failFetch, spawn: answering(0, "[]") });
  expect(out).toStrictEqual({ problems: [] });
  expect(calls.map((call) => call.args.at(-1))).toStrictEqual([".github/workflows/bench.yml"]);
});

it("prints one line per problem actionlint finds", async () => {
  const { root, cacheDir } = repo('["release"]', ["release.yml"]);

  const items = [
    { column: 9, filepath: "release.yml", line: 40, message: 'unexpected key "runs_on" for "job" section' },
    { column: 1, filepath: "release.yml", kind: "expression", line: 2, message: "bad" },
  ];

  const spawn = answering(1, JSON.stringify(items.map((item) => ({ kind: "syntax-check", ...item }))));
  const out = await checkActionlintAt(root, { cacheDir, fetch: failFetch, spawn });
  expect(out.problems).toStrictEqual([
    'actionlint: release.yml:40:9: unexpected key "runs_on" for "job" section [syntax-check]',
    "actionlint: release.yml:2:1: bad [expression]",
  ]);
});

it.each([
  [{ code: 2, line: "actionlint: exited 2: boom", name: "another exit code", stderr: "boom\n", stdout: "" }],
  [{ code: 1, line: "actionlint: exited 1: oops", name: "unparsable output", stderr: "oops\n", stdout: "not json" }],
  [{ code: 1, line: "actionlint: exited 1: ", name: "json of another shape", stderr: "", stdout: '{"a":1}' }],
])("reports $name as a failure line", async ({ code, stdout, stderr, line }) => {
  const { root, cacheDir } = repo('["release"]', ["ci.yml"]);
  const out = await checkActionlintAt(root, { cacheDir, fetch: failFetch, spawn: answering(code, stdout, stderr) });
  expect(out.problems).toStrictEqual([line]);
});
