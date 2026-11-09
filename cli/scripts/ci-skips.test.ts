import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { skipsMain, skippedIds, writeReport } from "./ci-skips.ts";
import { cleanTemps, read, tempDir, write } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const vitestJson = (name: string, results: [string, string][]) =>
  JSON.stringify({
    testResults: [{ name, assertionResults: results.map(([fullName, status]) => ({ fullName, status })) }],
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
  expect(skippedIds(json, root)).toEqual([
    "cli/b.test.ts > a pending",
    "cli/b.test.ts > m todo",
    "cli/b.test.ts > z skipped",
  ]);
});

it("a windows report with backslashed absolute paths gives the posix id", () => {
  const json = JSON.parse(vitestJson("C:\\work\\app\\cli\\a.test.ts", [["reads a symlink", "skipped"]]));
  expect(skippedIds(json, "C:\\work\\app")).toEqual(["cli/a.test.ts > reads a symlink"]);
});

it("a json that is not a vitest report has no skips", () => {
  expect(skippedIds({ nope: 1 }, "/x")).toEqual([]);
});

it("writeReport writes the os and the ids, and an absent vitest json gives an empty list", () => {
  const dir = tempDir("workerstack-skips-");
  write(dir, { "v.json": vitestJson(path.join(dir, "a.test.ts"), [["t", "skipped"]]) });
  writeReport(path.join(dir, "out.json"), path.join(dir, "v.json"), dir);
  expect(JSON.parse(read(dir, "out.json"))).toEqual({ os: process.platform, skipped: ["a.test.ts > t"] });
  writeReport(path.join(dir, "none.json"), path.join(dir, "missing.json"), dir);
  expect(JSON.parse(read(dir, "none.json"))).toEqual({ os: process.platform, skipped: [] });
  fs.writeFileSync(path.join(dir, "bad.json"), "{ nope");
  writeReport(path.join(dir, "bad-out.json"), path.join(dir, "bad.json"), dir);
  expect(JSON.parse(read(dir, "bad-out.json"))).toEqual({ os: process.platform, skipped: [] });
});

const report = (os: string, skipped: string[]) => JSON.stringify({ os, skipped });

function skips(files: Record<string, string>, dirName = "reports") {
  const root = tempDir("workerstack-skips-");
  write(root, files);
  const out: string[] = [];
  const err: string[] = [];
  const code = skipsMain(dirName, { cwd: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
  const shown = (s: string) => s.replaceAll(`${root}/`, "").replaceAll(root, ".");
  return { code, out: shown(out.join("")), err: shown(err.join("")) };
}

it("a test skipped in every report fails, naming the OSes", () => {
  const run = skips({
    "reports/ci-report-linux.json": report("linux", ["cli/a.test.ts > reads a symlink", "x > only linux"]),
    "reports/ci-report-win32.json": report("win32", ["cli/a.test.ts > reads a symlink"]),
    "reports/ci-report-darwin.json": report("darwin", ["cli/a.test.ts > reads a symlink", "x > only linux"]),
  });
  expect(run).toEqual({
    code: 1,
    out: "",
    err: "repo ci skips: cli/a.test.ts > reads a symlink is skipped on every OS (darwin, linux, win32); make it run on one or delete it\n",
  });
});

it("a test that ran on one OS passes, and the line counts the reports", () => {
  const run = skips({
    "reports/ci-report-linux.json": report("linux", ["a > t"]),
    "reports/ci-report-win32.json": report("win32", []),
    "reports/ignored.json": "{",
  });
  expect(run).toEqual({
    code: 0,
    out: "ci skips: 2 reports (linux, win32), no test skipped on all of them\n",
    err: "",
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
  expect(skips({ "reports/other.txt": "" })).toEqual({
    code: 1,
    out: "",
    err: "repo ci skips: reports has no ci-report-*.json; download the test jobs' reports first\n",
  });
  expect(skips({}).err).toBe(
    "repo ci skips: reports is not a directory; download the test jobs' reports into it first\n",
  );
  expect(
    skips({
      "reports/ci-report-linux.json": "{ nope",
      "reports/ci-report-win32.json": '{"os":1}',
      "reports/ci-report-a.json": report("a", []),
    }),
  ).toEqual({
    code: 1,
    out: "",
    err:
      "repo ci skips: reports/ci-report-linux.json is not a ci report: not valid JSON\n" +
      "repo ci skips: reports/ci-report-win32.json is not a ci report: expected { os: string, skipped: string[] }\n",
  });
  expect(skips({ "reports/ci-report-linux.json": report("linux", []) })).toEqual({
    code: 1,
    out: "",
    err: "repo ci skips: only 1 report (linux); every OS's test job must upload one\n",
  });
});
