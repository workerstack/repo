import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { childEnv } from "./env.ts";
import { checkActionlintAt, type Spawn } from "./actionlint.ts";

const dirs: string[] = [];
const temp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-actionlint-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const EXE = process.platform === "win32" ? "actionlint.exe" : "actionlint";
type Call = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
});
const answering =
  (code: number, stdout: string, stderr = ""): Spawn =>
  (command, args, options) => {
    calls.push({ command, args, ...options });
    return { code, stdout, stderr };
  };
const failFetch = () => Promise.reject(new Error("the cache should have been used"));

/** A repo with a config of `packs`, the workflow files named, and a cached binary. */
function repo(packs: string, workflows: string[]): { root: string; cacheDir: string } {
  const root = temp();
  const cacheDir = temp();
  fs.writeFileSync(path.join(cacheDir, EXE), "binary");
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), `export default { packs: ${packs} };\n`);
  const flows = path.join(root, ".github", "workflows");
  fs.mkdirSync(flows, { recursive: true });
  for (const name of workflows) fs.writeFileSync(path.join(flows, name), "name: x\n");
  return { root, cacheDir };
}

it("runs nothing without a config, without the release pack or without a workflow", async () => {
  const bare = temp();
  const spawn = answering(0, "");
  expect(await checkActionlintAt(bare, { spawn, fetch: failFetch })).toEqual({ problems: [] });
  const off = repo('["standards"]', ["ci.yml"]);
  expect(await checkActionlintAt(off.root, { spawn, fetch: failFetch, cacheDir: off.cacheDir })).toEqual({
    problems: [],
  });
  const none = repo('["release"]', ["notes.txt"]);
  fs.rmSync(path.join(none.root, ".github", "workflows", "notes.txt"));
  expect(await checkActionlintAt(none.root, { spawn, fetch: failFetch, cacheDir: none.cacheDir })).toEqual({
    problems: [],
  });
  fs.rmSync(path.join(none.root, ".github"), { recursive: true });
  expect(await checkActionlintAt(none.root, { spawn, fetch: failFetch, cacheDir: none.cacheDir })).toEqual({
    problems: [],
  });
  expect(calls).toEqual([]);
});

it("lints every .yml and .yaml workflow with the cached binary, in the repo root, and nothing else", async () => {
  vi.stubEnv("GIT_DIR", "/elsewhere");
  const { root, cacheDir } = repo('["release"]', ["b.yaml", "a.yml", "notes.txt"]);
  const out = await checkActionlintAt(root, { spawn: answering(0, "[]"), fetch: failFetch, cacheDir });
  expect(out).toEqual({ problems: [] });
  expect(calls).toHaveLength(1);
  const [call] = calls;
  expect(call?.command).toBe(path.join(cacheDir, EXE));
  expect(call?.args).toEqual([
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

it("prints one line per problem actionlint finds", async () => {
  const { root, cacheDir } = repo('["release"]', ["release.yml"]);
  const items = [
    { message: 'unexpected key "runs_on" for "job" section', filepath: "release.yml", line: 40, column: 9 },
    { message: "bad", filepath: "release.yml", line: 2, column: 1, kind: "expression" },
  ];
  const spawn = answering(1, JSON.stringify(items.map((item) => ({ kind: "syntax-check", ...item }))));
  const out = await checkActionlintAt(root, { spawn, fetch: failFetch, cacheDir });
  expect(out.problems).toEqual([
    'actionlint: release.yml:40:9: unexpected key "runs_on" for "job" section [syntax-check]',
    "actionlint: release.yml:2:1: bad [expression]",
  ]);
});

it.each([
  [{ name: "another exit code", code: 2, stdout: "", stderr: "boom\n", line: "actionlint: exited 2: boom" }],
  [{ name: "unparsable output", code: 1, stdout: "not json", stderr: "oops\n", line: "actionlint: exited 1: oops" }],
  [{ name: "json of another shape", code: 1, stdout: '{"a":1}', stderr: "", line: "actionlint: exited 1: " }],
])("reports $name as a failure line", async ({ code, stdout, stderr, line }) => {
  const { root, cacheDir } = repo('["release"]', ["ci.yml"]);
  const out = await checkActionlintAt(root, { spawn: answering(code, stdout, stderr), fetch: failFetch, cacheDir });
  expect(out.problems).toEqual([line]);
});
