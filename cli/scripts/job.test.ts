import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { pathSans, plant, plantFiles, useJobEnv } from "./__fixtures__/job-kit.ts";
import { runJob } from "./job.ts";

useJobEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const bin = path.join(here, "../../bin/repo.ts");

/** `repo job` as a user runs it, from `cwd`. */
function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = childEnv()) {
  return spawnSync(bunPath(), [bin, "job", ...args], { cwd, encoding: "utf8", env, timeout: 20_000 });
}

it("finds a token of this repo's own source and prints at most eight lines", () => {
  const r = runJob({ cwd: root, job: "search", query: "DEFAULT_GREP_HEAD_LIMIT" });
  expect(r.fallback).toBe(false);
  expect(r.text).toMatch(/^\d+ match(?:es)?/);
  expect(r.text).toMatch(/^- /m);
  expect(r.text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(8);
});

it("searches with no rg on PATH and scopes by path and glob", () => {
  const dir = plant();
  plantFiles(dir, {
    "a.txt": "hello\n",
    "b.txt": "world\n",
    "e.md": "hello\n",
    "sub/c.txt": "hello\n",
    "sub/d.txt": "nope\n",
  });
  const env = childEnv({ PATH: pathSans("rg") });
  const any = runCli(["--job", "search", "--query", "hello|world"], dir, env);
  expect([any.status, any.stdout]).toStrictEqual([0, expect.stringMatching(/^4 matches\.\n/)]);
  const scoped = runCli(["--job", "search", "--query", "hello", "--path", "sub"], dir, env);
  expect(scoped.stdout).toMatch(/^1 match\.\n- (?:\.\/)?sub\/c\.txt:1 — hello\n$/);
  const globbed = runCli(["--job", "search", "--query", "hello", "--glob", "*.md"], dir, env);
  expect(globbed.stdout).toMatch(/^1 match\.\n- (?:\.\/)?e\.md:1 — hello\n$/);
});

it("exits 2 and prints FALLBACK for what a plain command should run instead", () => {
  const dir = plant();
  const cases = [
    ["--job", "search", "--query", "foo node_modules"],
    ["--job", "exec", "--query", "printf '<html>x</html>'"],
    ["--job", "web", "--query", "https://example.com"],
    ["--job", "search", "--query", "x", "--wat"],
    ["--job", "exec", "--query", "true", "--cwd", ".."],
  ];
  for (const args of cases) {
    const r = runCli(args, dir);
    expect([args.join(" "), r.status, r.stdout]).toStrictEqual([args.join(" "), 2, "FALLBACK\n"]);
  }
});

it("runs an exec in --cwd and prints No output for a silent success", () => {
  const dir = plant();
  plantFiles(dir, { "sub/x.txt": "x" });
  const r = runCli(["--job", "exec", "--query", "true", "--cwd", "sub"], dir);
  expect([r.status, r.stdout]).toStrictEqual([0, "No output.\n"]);
});
