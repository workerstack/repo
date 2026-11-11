import fs from "node:fs";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { inDir, pathSans, plant, plantFiles, runMain, stashDirOf, useJobEnv } from "./__fixtures__/job-kit.ts";
import { runJob } from "./job.ts";

useJobEnv();
// Without rg the search prints plain file names, the same on every machine.
beforeEach(() => {
  vi.stubEnv("PATH", pathSans("rtk", "rg"));
});

const FALLBACK = "FALLBACK\n";

/** A planted root with files to search, two scripts and a 30-line stash `search-g7k.txt`. */
function workspace(): string {
  const dir = plant();
  plantFiles(dir, {
    "a.txt": "hello\n",
    "fail.js": "process.exit(1);",
    "ok.js": 'console.log("hi");',
    "pkg/b.txt": "hello\n",
  });
  plantFiles(stashDirOf(dir), { "search-g7k.txt": Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n") });
  return dir;
}

it("runJob falls back for no job, an unknown job, unknown flags and jobs missing their input", () => {
  const dir = plant();
  expect(runJob()).toStrictEqual({ code: 2, fallback: true, text: FALLBACK });
  expect(runJob({ cwd: dir, job: "web", query: "x" }).fallback).toBe(true);
  expect(runJob({ cwd: dir, job: "search", query: "x", unknown: true }).fallback).toBe(true);
  expect(runJob({ cwd: dir, job: "search", query: "" }).fallback).toBe(true);
  expect(runJob({ cwd: dir, job: "slice" }).fallback).toBe(true);
  expect(runJob({ cwd: dir, job: "fetch", query: "file:///etc/hosts" }).fallback).toBe(true);
});

it("runJob runs search, exec and slice from the workspace and keeps the stash at its root", () => {
  const dir = workspace();
  const sub = path.join(dir, "pkg");
  expect(runJob({ cwd: sub, job: "search", query: "hello", root: dir }).text).toBe("1 match.\n- b.txt:1 — hello\n");
  expect(runJob({ cwd: dir, job: "exec", query: "bun ok.js" }).text).toBe("1 line.\n- hi\n");
  const slice = runJob({ cwd: sub, from: "2", job: "slice", root: dir, stash: "g7k", to: "3" });
  expect(slice.text).toBe("2 lines.\n- stash:2 — row 2\n- stash:3 — row 3\n");
});

it("runJob finds the root of a cwd that is not given one, and the cwd of the process when it has neither", () => {
  const dir = workspace();
  const slice = { from: "1", job: "slice", stash: "g7k", to: "1" };
  expect(runJob({ ...slice, cwd: dir }).text).toBe("1 line.\n- stash:1 — row 1\n");
  expect(inDir(dir, () => runJob(slice)).text).toBe("1 line.\n- stash:1 — row 1\n");
});

it("main prints the verdict and exits 0, also for a failed command", () => {
  const dir = workspace();
  expect(runMain(["--job", "search", "--query", "hello", "--path", "pkg"], dir)).toStrictEqual({
    code: 0,
    out: "1 match.\n- pkg/b.txt:1 — hello\n",
  });
  expect(runMain(["--job", "exec", "--query", "bun fail.js"], dir)).toStrictEqual({
    code: 0,
    out: "Command failed.\n- exit 1\n",
  });
});

it("main runs the job in --cwd and reads a stash from the root", () => {
  const dir = workspace();
  expect(runMain(["--job", "search", "--query", "hello", "--cwd", "pkg"], dir).out).toBe(
    "1 match.\n- b.txt:1 — hello\n",
  );
  const slice = runMain(["--job=slice", "--stash=g7k", "--from=1", "--to=2"], dir);
  expect(slice).toStrictEqual({ code: 0, out: "2 lines.\n- stash:1 — row 1\n- stash:2 — row 2\n" });
});

it("main exits 2 with FALLBACK for unknown flags, a --cwd that leaves the workspace and a job to refuse", () => {
  const dir = workspace();
  const refused = { code: 2, out: FALLBACK };
  expect(runMain(["--job", "search", "--query", "x", "--wat"], dir)).toStrictEqual(refused);
  expect(runMain(["--job", "exec", "--query", "true", "--cwd", ".."], dir)).toStrictEqual(refused);
  expect(runMain(["--job", "web", "--query", "https://example.com"], dir)).toStrictEqual(refused);
  expect(runMain(["--job", "search", "--query", "x node_modules"], dir)).toStrictEqual(refused);
});

it("main exits 2 with FALLBACK when the job throws", () => {
  const dir = plant();
  fs.writeFileSync(path.join(dir, ".tmp"), "a file where the stash dir should go");
  plantFiles(dir, { "many.js": 'for (let i = 0; i < 20; i++) console.log("row " + i);' });
  expect(runMain(["--job", "exec", "--query", "bun many.js"], dir)).toStrictEqual({ code: 2, out: FALLBACK });
});
