import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { skipsMain, skippedIds, writeReport } from "./ci-skips.ts";
import { cleanTemps, read, tempDir, write } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const vitestJson = (name: string, results: [string, string][]) =>
  JSON.stringify({
    testResults: [{ assertionResults: results.map(([fullName, status]) => ({ fullName, status })), name }],
  });

it("ids are the posix path from the root, a separator and the full name, for tests that did not run, sorted and unique", () => {
  const root = "/work/app";
  const json = JSON.parse(
    vitestJson("/work/app/cli/b.test.ts", [
      ["z skipped", "skipped"],
      ["a pending", "pending"],
      ["a pending", "pending"],
      ["m todo", "todo"],
      ["ran", "passed"],
      ["broke", "failed"],
    ]),
  );
  expect(skippedIds(json, root)).toStrictEqual([
    "cli/b.test.ts > a pending",
    "cli/b.test.ts > m todo",
    "cli/b.test.ts > z skipped",
  ]);
});

it("a windows report with backslashed absolute paths gives the posix id", () => {
  const json = JSON.parse(vitestJson("C:\\work\\app\\cli\\a.test.ts", [["reads a symlink", "skipped"]]));
  expect(skippedIds(json, "C:\\work\\app")).toStrictEqual(["cli/a.test.ts > reads a symlink"]);
});

it("a json that is not a vitest report has no skips", () => {
  expect(skippedIds({ nope: 1 }, "/x")).toStrictEqual([]);
});

it("writeReport writes the os and the ids, and an absent vitest json gives an empty list", () => {
  const dir = tempDir("workerstack-skips-");
  write(dir, { "v.json": vitestJson(path.join(dir, "a.test.ts"), [["t", "skipped"]]) });
  writeReport(path.join(dir, "out.json"), path.join(dir, "v.json"), dir);
  expect(JSON.parse(read(dir, "out.json"))).toStrictEqual({
    durations: {},
    os: process.platform,
    skipped: ["a.test.ts > t"],
  });
  writeReport(path.join(dir, "none.json"), path.join(dir, "missing.json"), dir);
  expect(JSON.parse(read(dir, "none.json"))).toStrictEqual({ durations: {}, os: process.platform, skipped: [] });
  fs.writeFileSync(path.join(dir, "bad.json"), "{ nope");
  writeReport(path.join(dir, "bad-out.json"), path.join(dir, "bad.json"), dir);
  expect(JSON.parse(read(dir, "bad-out.json"))).toStrictEqual({ durations: {}, os: process.platform, skipped: [] });
});

function timed(name: string, startTime: number, endTime: number) {
  return { assertionResults: [], endTime, name, startTime };
}

it("writeReport adds the whole ms of endTime - startTime per file, by posix path from the root, keys sorted", () => {
  const dir = tempDir("workerstack-skips-");
  write(dir, {
    "v.json": JSON.stringify({
      testResults: [
        timed(path.join(dir, "cli", "z.test.ts"), 1000, 1500.4),
        timed(path.join(dir, "a.test.ts"), 2000, 13_850.6),
        { assertionResults: [], name: path.join(dir, "untimed.test.ts") },
      ],
    }),
  });
  writeReport(path.join(dir, "out.json"), path.join(dir, "v.json"), dir);
  const written = JSON.parse(read(dir, "out.json")) /* writeReport wrote durations as numbers */ as {
    durations: Record<string, number>;
  };
  expect(written.durations).toStrictEqual({ "a.test.ts": 11_851, "cli/z.test.ts": 500 });
  expect(Object.keys(written.durations)).toStrictEqual(["a.test.ts", "cli/z.test.ts"]);
});

const report = (os: string, skipped: string[]) => JSON.stringify({ os, skipped });

function skips(files: Record<string, string>, dirName = "reports") {
  const root = tempDir("workerstack-skips-");
  write(root, files);
  const out: string[] = [];
  const err: string[] = [];
  const code = skipsMain(dirName, { cwd: root, stderr: (s) => err.push(s), stdout: (s) => out.push(s) });
  const shown = (s: string) => s.replaceAll(`${root}/`, "").replaceAll(root, ".");
  return { code, err: shown(err.join("")), out: shown(out.join("")) };
}

it("a test skipped in every report fails, naming the OSes", () => {
  const run = skips({
    "reports/ci-report-darwin.json": report("darwin", ["cli/a.test.ts > reads a symlink", "x > only linux"]),
    "reports/ci-report-linux.json": report("linux", ["cli/a.test.ts > reads a symlink", "x > only linux"]),
    "reports/ci-report-win32.json": report("win32", ["cli/a.test.ts > reads a symlink"]),
  });
  expect(run).toStrictEqual({
    code: 1,
    err: "repo ci skips: cli/a.test.ts > reads a symlink is skipped on every OS (darwin, linux, win32); make it run on one or delete it\n",
    out: "",
  });
});

it("a test that ran on one OS passes, and the line counts the reports", () => {
  const run = skips({
    "reports/ci-report-linux.json": report("linux", ["a > t"]),
    "reports/ci-report-win32.json": report("win32", []),
    "reports/ignored.json": "{",
  });
  expect(run).toStrictEqual({
    code: 0,
    err: "",
    out: "ci skips: 2 reports (linux, win32), no test skipped on all of them\n",
  });
});

it("reports one level down, as download-artifact nests them, are read", () => {
  const run = skips({
    "reports/ci-report-linux/ci-report-linux.json": report("linux", ["a > t"]),
    "reports/ci-report-win32/ci-report-win32.json": report("win32", ["a > t"]),
    "reports/ci-report-win32/deeper/ci-report-x.json": "{",
  });
  expect(run.code).toBe(1);
  expect(run.err).toContain("a > t is skipped on every OS (linux, win32)");
});

it("an empty directory, a missing one, a bad file and a single report are named", () => {
  expect(skips({ "reports/other.txt": "" })).toStrictEqual({
    code: 1,
    err: "repo ci skips: reports has no ci-report-*.json; download the test jobs' reports first\n",
    out: "",
  });
  expect(skips({}).err).toBe(
    "repo ci skips: reports is not a directory; download the test jobs' reports into it first\n",
  );
  expect(
    skips({
      "reports/ci-report-a.json": report("a", []),
      "reports/ci-report-linux.json": "{ nope",
      "reports/ci-report-win32.json": '{"os":1}',
    }),
  ).toStrictEqual({
    code: 1,
    err:
      "repo ci skips: reports/ci-report-linux.json is not a ci report: not valid JSON\n" +
      "repo ci skips: reports/ci-report-win32.json is not a ci report: expected { os: string, skipped: string[] }\n",
    out: "",
  });
  expect(skips({ "reports/ci-report-linux.json": report("linux", []) })).toStrictEqual({
    code: 1,
    err: "repo ci skips: only 1 report (linux); every OS's test job must upload one\n",
    out: "",
  });
});

it("shards of one OS count once: two win32 shards and a linux report are 2 OSes, each named once", () => {
  const run = skips({
    "reports/ci-report-linux.json": report("linux", ["c > v"]),
    "reports/ci-report-win32-1.json": report("win32", ["a > t"]),
    "reports/ci-report-win32-2.json": report("win32", ["b > u"]),
  });
  expect(run).toStrictEqual({
    code: 0,
    err: "",
    out: "ci skips: 3 reports (linux, win32), no test skipped on all of them\n",
  });
});

it("a test skipped in one win32 shard and on linux fails, though the other shard did not list it", () => {
  const run = skips({
    "reports/ci-report-linux.json": report("linux", ["a > t"]),
    "reports/ci-report-win32-1.json": report("win32", ["a > t"]),
    "reports/ci-report-win32-2.json": report("win32", []),
  });
  expect(run).toStrictEqual({
    code: 1,
    err: "repo ci skips: a > t is skipped on every OS (linux, win32); make it run on one or delete it\n",
    out: "",
  });
});

it("three win32 shard reports alone are one OS and fail", () => {
  const run = skips({
    "reports/ci-report-win32-1.json": report("win32", []),
    "reports/ci-report-win32-2.json": report("win32", []),
    "reports/ci-report-win32-3.json": report("win32", []),
  });
  expect(run).toStrictEqual({
    code: 1,
    err: "repo ci skips: only 1 report (win32); every OS's test job must upload one\n",
    out: "",
  });
});

it("reports with and without durations are both read", () => {
  const timedReport = JSON.stringify({ durations: { "a.test.ts": 5 }, os: "linux", skipped: [] });
  const run = skips({
    "reports/ci-report-linux.json": timedReport,
    "reports/ci-report-win32.json": report("win32", []),
  });
  expect(run).toStrictEqual({
    code: 0,
    err: "",
    out: "ci skips: 2 reports (linux, win32), no test skipped on all of them\n",
  });
});

it("a report whose durations are not numbers is not a ci report", () => {
  const badReport = JSON.stringify({ durations: { "a.test.ts": "5" }, os: "linux", skipped: [] });
  const run = skips({
    "reports/ci-report-linux.json": badReport,
    "reports/ci-report-win32.json": report("win32", []),
  });
  expect(run.code).toBe(1);
  expect(run.err).toContain("reports/ci-report-linux.json is not a ci report");
});
