import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { ci, ciPacked, plant } from "./__fixtures__/ci-run.ts";
import { cleanTemps } from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

it("--shard 2/3 --no-coverage hands vitest that slice, passing an empty one, and the tests line names it", () => {
  const run = ci(plant(), ["--shard", "2/3", "--no-coverage"]);
  expect(run.code).toBe(0);
  expect(run.calls.repo).toStrictEqual(["check", "fmt --check"]);
  expect(run.calls.tsc).toHaveLength(2);
  expect(run.calls.vitest).toStrictEqual(["run --shard=2/3 --passWithNoTests"]);
  expect(run.out).toContain("ci: 4 tests passed (shard 2/3) (0.5s)\n");
  expect(run.out).toContain("ci: check ok · fmt ok · typecheck 2 configs · 4 tests passed (shard 2/3)\n");
});

it("--shard 1/1 is the whole run, with coverage", () => {
  const run = ci(plant(), ["--shard", "1/1"]);
  expect(run.code).toBe(0);
  expect(run.calls.vitest).toStrictEqual(["run --coverage"]);
  expect(run.out).toContain("ci: 4 tests passed (0.5s)\n");
});

it("a failing shard names its slice on the failed line", () => {
  const tests = { code: 1, stderr: "", stdout: " Tests  1 failed | 3 passed (4)\n" };
  const run = ci(plant(), ["--no-coverage", "--shard", "3/3"], { tests });
  expect(run.code).toBe(1);
  expect(run.out).toContain("ci: tests failed (1 failed, 3 passed) (shard 3/3) (0.5s)\n");
});

it.each([
  [["--shard", "0/3", "--no-coverage"], 'repo ci: --shard takes i/n with 1 ≤ i ≤ n, got "0/3"\n'],
  [["--shard", "4/3", "--no-coverage"], 'repo ci: --shard takes i/n with 1 ≤ i ≤ n, got "4/3"\n'],
  [["--no-coverage", "--shard", "x"], 'repo ci: --shard takes i/n with 1 ≤ i ≤ n, got "x"\n'],
])("repo ci %j is refused before any gate runs, exit 1", (argv, err) => {
  const run = ci(plant(), argv);
  expect(run).toMatchObject({ code: 1, err, out: "" });
  expect(run.calls).toStrictEqual({ repo: [], tsc: [], turbo: [], vitest: [] });
});

it.each([[["--nope"]], [["--shard"]]])("repo ci %j prints the usage line, which lists --shard, exit 1", (argv) => {
  const run = ci(plant(), argv);
  expect(run.code).toBe(1);
  expect(run.err).toMatch(/^repo ci: use repo ci \[--no-coverage\] \[--report <file>\] \[--shard <i>\/<n>\], /);
  expect(run.calls.repo).toStrictEqual([]);
});

it("--shard 2/3 with coverage writes a blob, leaves the floors to merge and keeps the default reporter", () => {
  const root = plant();
  const run = ci(root, ["--shard", "2/3"]);
  expect(run.code).toBe(0);
  expect(run.calls.vitest).toStrictEqual([
    `run --coverage --shard=2/3 --passWithNoTests --reporter=default --reporter=blob ` +
      `--outputFile.blob=${path.join(root, ".repo/tmp/blob/blob-2-3.json")} --coverage.thresholds=false`,
  ]);
  expect(run.out).toContain("ci: 4 tests passed (shard 2/3, floors left to repo ci merge) (0.5s)\n");
});

it("--shard 1/2 with coverage and --report keeps the json reporter and the default one", () => {
  const run = ci(plant(), ["--shard", "1/2", "--report", "r.json"], { json: { code: 0, stderr: "", stdout: "{}" } });
  const [args = ""] = run.calls.vitest;
  expect(args).toContain("--reporter=default --reporter=json --outputFile.json=");
  expect(args).toContain(" --reporter=blob --outputFile.blob=");
  expect(args.match(/--reporter=default/g)).toHaveLength(1);
});

it("--shard 2/3 with coverage under the workspace pack is refused before any gate runs, exit 1", () => {
  const run = ciPacked(plant(), ["--shard", "2/3"], () => ({ code: 0, stderr: "", stdout: "" }));
  expect(run).toMatchObject({
    code: 1,
    err: "repo ci: --shard with coverage needs one root vitest run; under the workspace pack pass --no-coverage\n",
    out: "",
  });
  expect(run.calls).toStrictEqual({ repo: [], tsc: [], turbo: [], vitest: [] });
});
