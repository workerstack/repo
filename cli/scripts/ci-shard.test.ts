import { afterEach, expect, it } from "vitest";

import { ci, plant } from "./fixtures/ci-run.ts";
import { cleanTemps } from "./fixtures/turn-repo.ts";

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
  [["--shard", "2/3"], "repo ci: --shard needs --no-coverage: the per-file floors need every test in one run\n"],
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
