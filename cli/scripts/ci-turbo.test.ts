import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defineProject } from "../../presets/vitest.ts";
import type { Captured } from "./lint.ts";
import { mergeReports, type TurboRun } from "./ci-turbo.ts";
import { ci, ciConfigured, ciPacked, plant } from "./fixtures/ci-run.ts";
import { cleanTemps, tempDir } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const SUMMARY = (tasks: number, cached: number) =>
  `Tasks:    ${tasks - 1} successful, ${tasks} total\nCached:    ${cached} cached, ${tasks} total\n  Time:    1s\n`;
const done =
  (tasks: number, cached: number): TurboRun =>
  () => ({ code: 0, stdout: SUMMARY(tasks, cached), stderr: "" });
const ARGS = ["run", "typecheck", "test", "--cache-dir=.turbo/cache", "--output-logs=errors-only"];
/** The tsconfig a tsc call checks. */
const projectOf = (call: string) => call.split(" -p ").at(-1);

it("under the pack typechecks only the root tsconfigs, runs turbo and prints the packages line", () => {
  const run = ciPacked(plant({ "tsconfig.build.json": "{}\n" }), [], done(4, 0));
  expect(run).toMatchObject({
    code: 0,
    out:
      "ci: check ok (0.5s)\nci: fmt ok (0.5s)\nci: typecheck 2 configs (0.5s)\nci: packages 4 tasks, 0 cached (0.5s)\n" +
      "ci: check ok · fmt ok · typecheck 2 configs · packages 4 tasks, 0 cached\n",
  });
  expect(run.calls.tsc.map(projectOf)).toStrictEqual(["tsconfig.build.json", "tsconfig.json"]);
  expect(run.calls.vitest).toStrictEqual([]);
  expect(run.calls.turbo).toStrictEqual([{ args: ARGS, env: { REPO_COVERAGE: "1" } }]);
});

it("counts the cached tasks of a rerun", () => {
  expect(ciPacked(plant(), [], done(4, 4)).out).toContain("ci: packages 4 tasks, 4 cached (0.5s)\n");
});

it("says only that the packages passed when turbo prints no summary", () => {
  const run = ciPacked(plant(), [], () => ({ code: 0, stdout: "", stderr: "" }));
  expect(run.out).toContain("ci: packages ok (0.5s)\n");
});

it("--no-coverage sets REPO_COVERAGE=0 and --report sets REPO_VITEST_REPORT", () => {
  const root = plant();
  const first = ciPacked(root, ["--no-coverage"], done(2, 0));
  expect(first.calls.turbo[0]?.env).toStrictEqual({ REPO_COVERAGE: "0" });
  const second = ciPacked(root, ["--report", "r.json"], done(2, 0));
  expect(second.calls.turbo[0]?.env).toStrictEqual({
    REPO_COVERAGE: "1",
    REPO_VITEST_REPORT: ".turbo/vitest-report.json",
  });
  const both = ciPacked(root, ["--report", "r.json", "--no-coverage"], done(2, 0));
  expect(both.calls.turbo[0]?.env).toStrictEqual({
    REPO_COVERAGE: "0",
    REPO_VITEST_REPORT: ".turbo/vitest-report.json",
  });
});

it("--shard 2/3 --no-coverage sets REPO_VITEST_SHARD, and the packages line names the slice", () => {
  const run = ciPacked(plant(), ["--shard", "2/3", "--no-coverage"], done(4, 0));
  expect(run.code).toBe(0);
  expect(run.calls.turbo).toStrictEqual([{ args: ARGS, env: { REPO_COVERAGE: "0", REPO_VITEST_SHARD: "2/3" } }]);
  expect(run.out).toContain("ci: packages 4 tasks, 0 cached (shard 2/3) (0.5s)\n");
  expect(run.out).toContain(" · packages 4 tasks, 0 cached (shard 2/3)\n");
});

it("a failing sharded turbo names the slice on the failed line", () => {
  const run = ciPacked(plant(), ["--no-coverage", "--shard", "1/2"], () => ({ code: 1, stdout: "", stderr: "" }));
  expect(run.out).toContain("ci: packages failed (shard 1/2) (0.5s)\n");
});

it("a package's project, given the env of a sharded turbo run, runs that slice and passes an empty one", () => {
  const run = ciPacked(plant(), ["--shard", "2/3", "--no-coverage"], done(4, 0));
  for (const [name, value] of Object.entries(run.calls.turbo[0]?.env ?? {})) vi.stubEnv(name, value);
  expect({ ...defineProject({}).test }).toMatchObject({ shard: "2/3", passWithNoTests: true });
});

it("--shard 1/1 sets no shard variable, and a project without it runs every file", () => {
  const run = ciPacked(plant(), ["--shard", "1/1"], done(4, 0));
  expect(run.calls.turbo[0]?.env).toStrictEqual({ REPO_COVERAGE: "1" });
  vi.stubEnv("REPO_VITEST_SHARD", "");
  const test = { ...defineProject({}).test };
  expect(test).not.toHaveProperty("shard");
  expect(test).not.toHaveProperty("passWithNoTests");
});

const report = (name: string, status: string) => ({
  numTotalTests: 2,
  numPassedTests: 1,
  success: true,
  testResults: [
    {
      name,
      assertionResults: [
        { fullName: "ran", status: "passed" },
        { fullName: "later", status },
      ],
    },
  ],
});

it("merges each package's report into the --report file after turbo", () => {
  const root = plant({ "packages/b/package.json": '{ "name": "b" }\n' });
  const turbo: TurboRun = () => {
    for (const pkg of ["a", "b"]) {
      const file = path.join(root, `packages/${pkg}/.turbo/vitest-report.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(report(path.join(root, `packages/${pkg}/x.test.ts`), "todo")));
    }
    return { code: 0, stdout: SUMMARY(4, 0), stderr: "" };
  };
  const run = ciPacked(root, ["--report", "r.json"], turbo);
  expect(run.code).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"))).toStrictEqual({
    os: process.platform,
    skipped: ["packages/a/x.test.ts > later", "packages/b/x.test.ts > later"],
  });
});

it("a package that wrote no report, or an unreadable one, adds no skips", () => {
  const root = plant({ "packages/b/package.json": '{ "name": "b" }\n' });
  fs.mkdirSync(path.join(root, "packages/b/.turbo"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages/b/.turbo/vitest-report.json"), "{ nope");
  ciPacked(root, ["--report", "r.json"], done(2, 0));
  expect(JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"))).toStrictEqual({
    os: process.platform,
    skipped: [],
  });
});

it("mergeReports concatenates testResults and sums the counts", () => {
  const merged = mergeReports([report("a.test.ts", "todo"), { ...report("b.test.ts", "passed"), success: false }]);
  expect(merged).toMatchObject({ numTotalTests: 4, numPassedTests: 2, success: false });
  expect(merged).toMatchObject({ testResults: [{ name: "a.test.ts" }, { name: "b.test.ts" }] });
  expect(mergeReports([])).toStrictEqual({ success: true, testResults: [] });
});

it("a failing package task prints its id and turbo's output under the line, exit 1", () => {
  const failed: Captured = { code: 1, stdout: "b:test: AssertionError\n", stderr: ` Failed:    b#test, a#typecheck\n` };
  const run = ciPacked(plant(), [], () => failed);
  expect(run.code).toBe(1);
  expect(run.out).toContain("ci: packages failed (b#test, a#typecheck) (0.5s)\nb:test: AssertionError\n Failed:");
  expect(run.out).toContain(" · packages failed (b#test, a#typecheck)\n");
});

it("a failing turbo with no Failed line says only that it failed", () => {
  const run = ciPacked(plant(), [], () => ({ code: 1, stdout: "", stderr: "boom\n" }));
  expect(run.out).toContain("ci: packages failed (0.5s)\nboom\n");
});

it("a missing platform binary prints the fix, without a time, exit 1", () => {
  const line = "turbo has no @turbo/linux-arm64 binary; run `bun install` so its optional dependency installs";
  const run = ciPacked(plant(), [], () => ({ missing: line }));
  expect(run.code).toBe(1);
  expect(run.out).toContain(`ci: packages failed: ${line}\n`);
});

it("the report is still written after a failing turbo", () => {
  const root = plant();
  ciPacked(root, ["--report", "r.json"], () => ({ code: 1, stdout: "", stderr: "" }));
  expect(fs.existsSync(path.join(root, "r.json"))).toBe(true);
});

it("without the pack the gates are unchanged and turbo never runs", () => {
  const run = ci(plant());
  expect({ ...run.calls, tsc: run.calls.tsc.map(projectOf) }).toStrictEqual({
    repo: ["check", "fmt --check"],
    tsc: ["tsconfig.json", "packages/a/tsconfig.json"],
    vitest: ["run --coverage"],
    turbo: [],
  });
});

it("mergeReports leaves out what is not a report", () => {
  expect(mergeReports([5, null, report("a.test.ts", "todo")])).toMatchObject({ numTotalTests: 2, success: true });
});

it("a workspace that cannot be read adds no package reports", () => {
  const root = plant({ "packages/a/package.json": "{ nope" });
  ciPacked(root, ["--report", "r.json"], done(2, 0));
  expect(JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"))).toStrictEqual({
    os: process.platform,
    skipped: [],
  });
});

it("reads the packs from the config when none are injected: workspace runs turbo", async () => {
  const root = plant({ "workerstack.config.ts": 'export default { packs: ["workspace"] };\n' });
  const run = await ciConfigured(root, done(4, 0));
  expect(run.calls.turbo).toHaveLength(1);
  expect(run.calls.vitest).toStrictEqual([]);
});

it("an invalid config runs the gates of a repo without the pack", async () => {
  const run = await ciConfigured(plant({ "workerstack.config.ts": "export default 1;\n" }), done(4, 0));
  expect(run.calls.turbo).toStrictEqual([]);
  expect(run.calls.vitest).toStrictEqual(["run --coverage"]);
});

it("outside a repo the unconfigured run is refused", async () => {
  const run = await ciConfigured(tempDir("workerstack-ci-none-"), done(4, 0));
  expect(run.code).toBe(1);
  expect(run.err).toContain("no workerstack.config.ts");
});
