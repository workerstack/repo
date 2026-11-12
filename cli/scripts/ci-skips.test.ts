import { afterEach, expect, it } from "vitest";

import { cleanTemps, tempDir, write } from "./__fixtures__/turn-repo.ts";
import { skipsMain } from "./ci-skips.ts";

afterEach(cleanTemps);

function report(os: string, skipped: string[]) {
  return JSON.stringify({ os, skipped });
}

function skips(files: Record<string, string>, dirName = "reports") {
  const root = tempDir("workerstack-skips-");
  write(root, files);
  const out: string[] = [];
  const err: string[] = [];
  const code = skipsMain(dirName, { cwd: root, stderr: (s) => err.push(s), stdout: (s) => out.push(s) });

  function shown(s: string) {
    return s.replaceAll(`${root}/`, "").replaceAll(root, ".");
  }

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
    err:
      "repo ci skips: cli/a.test.ts > reads a symlink is skipped on every OS (darwin, linux, win32); " +
      "make it run on one or delete it\n",
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
