import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { bad, ci, plant, reportAt } from "./__fixtures__/ci-run.ts";
import {
  ANSWER,
  cleanTemps,
  consumer,
  git,
  precommit,
  recording,
  SLOW,
  tempDir,
  write,
} from "./__fixtures__/turn-repo.ts";
import type { Captured } from "./lint.ts";
import { NODE_CONFIG, testRuns } from "./node-run.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

/** A node config that holds the package's node tests; its text is never run, since the bins are faked. */
const NODE_FILES = { [NODE_CONFIG]: "export default {};\n" };

/** A consumer whose manifest names the node range a node config needs, with `src/answer.ts` staged as changed. */
function stagedConsumer(): string {
  const manifest = { devEngines: { runtime: { name: "node", version: ">=22.12.0" } }, name: "app", type: "module" };
  const root = consumer({ ...NODE_FILES, "package.json": `${JSON.stringify(manifest)}\n`, "src/answer.ts": ANSWER });
  write(root, { "src/answer.ts": "export const answer = 43;\n" });
  git(root, "add", "src/answer.ts");

  return root;
}

/** Bins whose tsc passes and whose vitest answers the main run with `main` and the node run with `node`. */
function answering(main: Captured, node: Captured): Bins {
  const ok: Captured = { code: 0, stderr: "", stdout: "" };

  return {
    tsc: () => Promise.resolve(ok),
    vitest: (_args, _cwd, run) => Promise.resolve(run === "node" ? node : main),
  };
}

const TWO_PASSED: Captured = { code: 0, stderr: "", stdout: " Tests  2 passed (2)\n" };

it(
  "precommit runs the related tests in the main run and the node run of the owning package",
  { timeout: SLOW },
  async () => {
    const root = stagedConsumer();
    const { bins, calls } = recording(root);
    await precommit(root, bins);
    const related = "related --run --passWithNoTests src/answer.ts";
    expect(calls.filter((call) => call.startsWith("vitest"))).toStrictEqual([
      `vitest . ${related}`,
      `vitest-node . ${related}`,
    ]);
  },
);

it("precommit fails when only the node run fails, and sums the counts of both runs", { timeout: SLOW }, async () => {
  const root = stagedConsumer();
  const failing = { code: 1, stderr: "", stdout: " Tests  1 failed | 2 passed (3)\n" };
  const run = await precommit(root, answering(TWO_PASSED, failing));
  expect(run.out).toContain(" · 5 related tests, 1 failed");
  expect(run.err).toBe(failing.stdout);
  expect(run.code).toBe(1);

  // A failing gate records no pass, so this one runs the tests again.
  const passing = await precommit(
    root,
    answering(TWO_PASSED, { code: 0, stderr: "", stdout: " Tests  3 passed (3)\n" }),
  );

  expect(passing.out).toContain(" · 5 related tests passed");
  expect(passing.code).toBe(0);
});

it("repo ci runs the node run after the main run and counts both", async () => {
  const run = await ci(plant(NODE_FILES));
  expect(run.calls.vitest).toStrictEqual(["run --coverage", "node run --coverage"]);
  expect(run.out).toContain("ci: 8 tests passed (0.5s)\n");
  expect(run.code).toBe(0);
});

it("repo ci --no-coverage runs the node run without coverage too", async () => {
  const run = await ci(plant(NODE_FILES), ["--no-coverage"]);
  expect(run.calls.vitest).toStrictEqual(["run", "node run"]);
  expect(run.code).toBe(0);
});

it("repo ci fails when only the node run fails, printing its output", async () => {
  const run = await ci(plant(NODE_FILES), [], { nodeTests: bad(" Tests  1 failed | 3 passed (4)\n") });
  expect(run.out).toContain("ci: tests failed (1 failed, 7 passed) (0.5s)\n");
  expect(run.out).toContain(" Tests  1 failed | 3 passed (4)\n");
  expect(run.code).toBe(1);
});

it("a coverage shard 1/n runs the whole node run with its floors and no blob; later shards do not", async () => {
  const first = await ci(plant(NODE_FILES), ["--shard", "1/2"]);
  expect(first.calls.vitest).toHaveLength(2);
  expect(first.calls.vitest[1]).toBe("node run --coverage");

  const second = await ci(plant(NODE_FILES), ["--shard", "2/2"]);
  expect(second.calls.vitest).toHaveLength(1);
  expect(second.calls.vitest[0]).not.toMatch(/^node /);
});

it("the skip report holds the skipped tests of both runs", async () => {
  const root = plant(NODE_FILES);

  /** vitest's json report of one file whose one test was skipped. */
  function skipped(file: string): Captured {
    const results = [{ assertionResults: [{ fullName: "t", status: "skipped" }], name: `${root}/${file}` }];

    return { code: 0, stderr: "", stdout: JSON.stringify({ testResults: results }) };
  }

  const run = await ci(root, ["--report", "r.json"], { json: skipped("a.test.ts"), nodeJson: skipped("b.test.ts") });
  expect(run.code).toBe(0);
  expect(reportAt(root)).toMatchObject({ skipped: ["a.test.ts > t", "b.test.ts > t"] });
});

/** A workspace whose root holds the repo config and whose `packages/api` member holds `member`. */
function member(files: Record<string, string>): string {
  const root = tempDir("workerstack-runs-");
  write(root, { "package.json": '{ "name": "app", "workspaces": ["packages/*"] }\n', ...files });

  return path.join(root, "packages/api");
}

it.each<[string, Record<string, string>, readonly string[]]>([
  ["declares no vitest and holds no config: it tests otherwise", {}, []],
  ["declares vitest", { "packages/api/package.json": '{ "devDependencies": { "vitest": "5.1.0" } }\n' }, ["main"]],
  ["holds a vitest config", { "packages/api/vitest.config.ts": "export default {};\n" }, ["main"]],
  [
    "holds the node config too",
    { "packages/api/vitest.config.ts": "", [`packages/api/${NODE_CONFIG}`]: "" },
    ["main", "node"],
  ],
])("a member that %s gets those vitest runs", (_, files, runs) => {
  expect(
    testRuns(member({ "packages/api/package.json": '{ "name": "api" }\n', ...files }), { member: true }),
  ).toStrictEqual(runs);
});

it("the root runs vitest though its manifest names none, as the shared dev tools install there", () => {
  expect(testRuns(path.dirname(path.dirname(member({}))))).toStrictEqual(["main"]);
});
