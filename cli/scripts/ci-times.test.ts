import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanTemps, read, tempDir, write } from "./__fixtures__/turn-repo.ts";
import { timesMain, type TimesTable } from "./ci-times.ts";

afterEach(cleanTemps);

function report(os: string, durations?: Record<string, number>): string {
  return JSON.stringify({ durations, os, skipped: [] });
}

function times(files: Record<string, string>, dirName = "reports", { config = true }: { config?: boolean } = {}) {
  const root = tempDir("workerstack-times-");
  write(root, { ...(config ? { "repo.config.ts": "export default {};\n" } : {}), ...files });
  const out: string[] = [];
  const err: string[] = [];
  const code = timesMain(dirName, { cwd: root, stderr: (s) => err.push(s), stdout: (s) => out.push(s) });

  return { code, err: err.join(""), out: out.join(""), root };
}

it("merges the reports per os, the largest duration winning, and writes the sorted table", () => {
  const run = times({
    "reports/ci-report-darwin.json": report("darwin", { "z.test.ts": 9 }),
    "reports/ci-report-linux/ci-report-linux.json": report("linux", { "a.test.ts": 7 }),
    "reports/ci-report-win32-1.json": report("win32", { "a.test.ts": 100, "b.test.ts": 300 }),
    "reports/ci-report-win32-2.json": report("win32", { "a.test.ts": 250, "c.test.ts": 5 }),
  });

  expect(run).toMatchObject({
    code: 0,
    err: "",
    out: "repo ci times: wrote .repo/test-times.json (darwin 1 files, linux 1 files, win32 3 files)\n",
  });
  const table = read(run.root, ".repo/test-times.json");
  const parsed = JSON.parse(table) /* ci times wrote a TimesTable */ as TimesTable;
  expect(parsed).toStrictEqual({
    darwin: { "z.test.ts": 9 },
    linux: { "a.test.ts": 7 },
    win32: { "a.test.ts": 250, "b.test.ts": 300, "c.test.ts": 5 },
  });
  expect(Object.keys(parsed)).toStrictEqual(["darwin", "linux", "win32"]);
  expect(Object.keys(parsed["win32"] ?? {})).toStrictEqual(["a.test.ts", "b.test.ts", "c.test.ts"]);
  expect(table.endsWith("\n")).toBe(true);
});

it("a report without durations adds no file to its os", () => {
  const run = times({ "reports/ci-report-linux.json": report("linux") });
  expect(run.out).toBe("repo ci times: wrote .repo/test-times.json (linux 0 files)\n");
  expect(JSON.parse(read(run.root, ".repo/test-times.json"))).toStrictEqual({ linux: {} });
});

it("an empty directory and a path that is no directory are named, exit 1, and write nothing", () => {
  const empty = times({ "reports/other.txt": "" });
  expect(empty).toMatchObject({ code: 1, err: "repo ci times: no ci-report-*.json in reports\n", out: "" });
  expect(fs.existsSync(path.join(empty.root, ".repo/test-times.json"))).toBe(false);
  expect(times({}, "gone")).toMatchObject({ code: 1, err: "repo ci times: no ci-report-*.json in gone\n", out: "" });
});

it("a report that is not one is named with the shape it needs, one line each", () => {
  const files = {
    "x/ci-report-Linux-0.json": '{"os":1}',
    "x/ci-report-Linux-1.json": "{ nope",
    "x/ci-report-Linux-2.json": report("linux", { "a.test.ts": 1 }),
  };

  const run = times(files, "x");
  expect(run).toMatchObject({
    code: 1,
    err:
      "repo ci times: x/ci-report-Linux-0.json: expected { os: string, skipped: string[] }\n" +
      "repo ci times: x/ci-report-Linux-1.json: not valid JSON\n",
    out: "",
  });
  expect(fs.existsSync(path.join(run.root, ".repo/test-times.json"))).toBe(false);
});

it("outside a repo there is no root to write the table to", () => {
  const run = times({ "reports/ci-report-linux.json": report("linux", { "a.test.ts": 1 }) }, "reports", {
    config: false,
  });

  expect(run.code).toBe(1);
  expect(run.err).toMatch(/^repo ci times: no repo\.config\.ts in .+ or any parent; run `bun repo init`\n$/);
  expect(run.out).toBe("");
});
