import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { main } from "./ci.ts";
import { ci, plant } from "./fixtures/ci-run.ts";
import { cleanTemps } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const USAGE =
  "repo ci: use repo ci [--no-coverage] [--report <file>], repo ci skips <dir> or repo ci wait [<branch>] (exits 0 passed, 1 failed, 2 superseded, 3 nothing to wait on, 4 error)\n";

it.each([
  ["src/a.test.ts"],
  ["--report"],
  ["--report", "a", "b"],
  ["--no-coverage", "--report"],
  ["--no-coverage", "extra"],
  ["skips"],
  ["skips", "a", "b"],
])("the arguments %j are refused with the usage line, and no gate runs", (...argv) => {
  const run = ci(plant(), argv);
  expect(run).toMatchObject({ code: 1, out: "", err: USAGE, calls: { repo: [], tsc: [], vitest: [] } });
});

it("--report to a directory that does not exist fails with the file named", () => {
  const run = ci(plant(), ["--report", "missing/r.json"]);
  expect(run.code).toBe(1);
  expect(run.err).toMatch(/^repo ci: cannot write missing\/r\.json: .+\n$/);
});

it("--report writes the file after the gates, and the stdout is still the gate lines", () => {
  const root = plant();
  const json = JSON.stringify({
    testResults: [{ name: path.join(root, "src/a.test.ts"), assertionResults: [{ fullName: "t", status: "todo" }] }],
  });
  const run = ci(root, ["--report", "r.json"], { json: { code: 0, stdout: json, stderr: "" } });
  expect(run.code).toBe(0);
  expect(run.out.split("\n")).toHaveLength(6);
  expect(run.calls.vitest[0]).toMatch(
    /^run --coverage --reporter=default --reporter=json --outputFile\.json=.+vitest\.json$/,
  );
  expect(JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"))).toStrictEqual({
    os: process.platform,
    skipped: ["src/a.test.ts > t"],
  });
});

it("--report with vitest absent still writes a report with no skips", () => {
  const root = plant();
  const run = ci(root, ["--report", "r.json"], { tests: null });
  expect(run.code).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"))).toStrictEqual({
    os: process.platform,
    skipped: [],
  });
});

it("skips <dir> reads the reports in the directory relative to the working directory", () => {
  const root = plant({
    "reports/ci-report-a.json": '{"os":"a","skipped":["x > t"]}',
    "reports/ci-report-b.json": '{"os":"b","skipped":["x > t"]}',
  });
  const run = ci(root, ["skips", "reports"]);
  expect(run).toMatchObject({
    code: 1,
    out: "",
    err: "repo ci skips: x > t is skipped on every OS (a, b); make it run on one or delete it\n",
    calls: { repo: [], tsc: [], vitest: [] },
  });
});

it("wait is routed to the wait command with the injected runners", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(["wait"], {
    cwd: "/repo",
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    git: () => ({ code: 1, stdout: "", stderr: "no git" }),
  });
  expect(code).toBe(4);
  expect(err.join("")).toBe("repo ci wait: cannot read HEAD (no git); run it inside a git checkout\n");
});

it("--no-coverage runs vitest without --coverage, and passes the other gates unchanged", () => {
  const run = ci(plant(), ["--no-coverage"]);
  expect(run.code).toBe(0);
  expect(run.calls.vitest).toStrictEqual(["run"]);
  expect(run.calls.tsc).toHaveLength(2);
});

it.each([
  ["--no-coverage", "--report", "r.json"],
  ["--report", "r.json", "--no-coverage"],
])("--no-coverage combines with --report in the order %j, and the report is still written", (...argv) => {
  const root = plant();
  const run = ci(root, argv);
  expect(run.code).toBe(0);
  expect(run.calls.vitest[0]).toMatch(/^run --reporter=default --reporter=json --outputFile\.json=.+vitest\.json$/);
  expect(JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"))).toStrictEqual({
    os: process.platform,
    skipped: [],
  });
});
