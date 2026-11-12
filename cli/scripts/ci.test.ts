import type { SpawnSyncReturns } from "node:child_process";

import { afterEach, expect, it } from "vitest";

import { ciFromConfig, spawnReply } from "./__fixtures__/ci-config-run.ts";
import { ci, bad, OK, PASSED, plant } from "./__fixtures__/ci-run.ts";
import { cleanTemps, tempDir, write } from "./__fixtures__/turn-repo.ts";
import { main } from "./ci.ts";

afterEach(cleanTemps);

it("every gate passing prints each gate line, then the summary, and exits 0", () => {
  const run = ci(plant());
  expect(run).toMatchObject({
    code: 0,
    err: "",
    out:
      "ci: check ok (0.5s)\nci: fmt ok (0.5s)\nci: typecheck 2 configs (0.5s)\nci: 4 tests passed (0.5s)\n" +
      "ci: check ok · fmt ok · typecheck 2 configs · 4 tests passed\n",
  });
  expect({ ...run.calls, tsc: run.calls.tsc.map((call) => call.split(" -p ").at(-1)) }).toStrictEqual({
    repo: ["check", "fmt --check"],
    tsc: ["tsconfig.json", "packages/a/tsconfig.json"],
    turbo: [],
    vitest: ["run --coverage"],
  });
});

const FAILING = {
  check: { fail: { check: bad("bad manifest\n") }, label: "check failed", shown: "bad manifest\n" },
  fmt: { fail: { fmt: bad("src/a.ts\n") }, label: "fmt failed", shown: "src/a.ts\n" },
  tests: {
    fail: { tests: { code: 1, stderr: "AssertionError\n", stdout: " Tests  1 failed | 3 passed (4)\n" } },
    label: "tests failed (1 failed, 3 passed)",
    shown: " Tests  1 failed | 3 passed (4)\nAssertionError\n",
  },
  typecheck: {
    fail: { "packages/a/tsconfig.json": bad("a.ts(1,1): error TS2322") },
    label: "typecheck failed (packages/a/tsconfig.json)",
    shown: "a.ts(1,1): error TS2322\n",
  },
};

it.each(Object.entries(FAILING))(
  "a failing %s gate prints its output under its line, later gates still run, exit 1",
  (_, { label, fail, shown }) => {
    const run = ci(plant(), [], fail);
    const lines = run.out.split("\n");
    const at = lines.findIndex((line) => line.startsWith(`ci: ${label}`));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at + 1).join("\n")).toContain(shown);
    expect(run.code).toBe(1);
    expect(run.calls.vitest).toStrictEqual(["run --coverage"]);
    expect(lines.at(-2)).toContain(label);
  },
);

it("a test run that fails without counts says only that it failed", () => {
  const run = ci(plant(), [], { tests: { code: 1, stderr: "boom\n", stdout: "" } });
  expect(run.out).toContain("ci: tests failed (0.5s)\nboom\n");
  expect(run.code).toBe(1);
});

it("typechecks every tsconfig in the root and each package, not fixtures or installs", () => {
  const root = plant({
    "__fixtures__/f/package.json": '{ "name": "f" }\n',
    "__fixtures__/f/tsconfig.json": "{}\n",
    "package.json": '{ "name": "app", "workspaces": ["packages/*", "__fixtures__/*", "vendor/*/*"] }\n',
    "packages/a/tsconfig.test.json": "{}\n",
    "tsconfig-notes.txt": "",
    "tsconfig.build.json": "{}\n",
    "tsconfig.src.json": "{}\n",
    [`vendor/node_modules/w/package.json`]: '{ "name": "w" }\n',
    [`vendor/node_modules/w/tsconfig.json`]: "{}\n",
    [`vendor/x/y/node_modules/z/tsconfig.json`]: "{}\n",
    "vendor/x/y/package.json": '{ "name": "y" }\n',
  });

  const run = ci(root);
  expect(run.calls.tsc.map((call) => call.split(" -p ").at(-1))).toStrictEqual([
    "tsconfig.build.json",
    "tsconfig.json",
    "tsconfig.src.json",
    "packages/a/tsconfig.json",
    "packages/a/tsconfig.test.json",
  ]);
  expect(run.out).toContain("typecheck 5 configs");
});

it("a workspace that cannot be read fails the typecheck gate with the reason", () => {
  const run = ci(plant({ "packages/a/package.json": "{ nope" }));
  expect(run.code).toBe(1);
  expect(run.out).toMatch(/ci: typecheck failed \(0\.5s\)\n.*packages\/a\/package\.json/);
  expect(run.calls.tsc).toStrictEqual([]);
});

it("when vitest is absent the tests gate is skipped and the run still passes", () => {
  const run = ci(plant(), [], { tests: null });
  expect(run.code).toBe(0);
  expect(run.out).toContain("ci: tests skipped (no vitest in .)\n");
  expect(run.out).toContain(" · tests skipped (no vitest in .)\n");
});

it("a repo with no tsconfig skips the typecheck gate without a time", () => {
  const root = tempDir("workerstack-ci-bare-");
  write(root, { "package.json": '{ "name": "app" }\n', "workerstack.config.ts": "export default {};\n" });
  const run = ci(root);
  expect(run.code).toBe(0);
  expect(run.out).toContain("ci: typecheck skipped (no tsconfig.json)\n");
  expect(run.out).toContain(" · typecheck skipped (no tsconfig.json) · ");
  expect(run.calls.tsc).toStrictEqual([]);
});

it("outside a repo the run is refused", () => {
  const run = ci(tempDir("workerstack-ci-empty-"));
  expect(run.code).toBe(1);
  expect(run.err).toMatch(/^repo ci: no workerstack\.config\.ts in .* or any parent; run `bun repo init`\n$/);
});

const CHECKS = {
  "container-images": ["bun", "scripts/check/container-images.ts"],
  // Checks run in config order, so infra-gen sits after product-tree to show the order is not sorted.
  "product-tree": ["bun", "scripts/check/product-tree.ts"],

  "infra-gen": ["infra-gen-cli", "--check"],
};

/** `repo ci` with the gates faked and the config's checks run by a fake spawner that answers by command. */
function withChecks(answers: Record<string, Partial<SpawnSyncReturns<string>>>) {
  const root = plant();
  const out: string[] = [];
  const spawned: { cmd: string; args: string[]; cwd: unknown }[] = [];
  let clock = 0;

  const code = main([], {
    bins: { tsc: () => OK, vitest: () => PASSED },
    checks: CHECKS,
    cwd: root,
    now: () => (clock += 500),
    packs: [],
    repo: () => OK,
    spawn: (cmd, args, opts) => {
      spawned.push({ args, cmd, cwd: opts.cwd });

      return spawnReply(answers[cmd === "bun" ? (args[0] ?? cmd) : cmd]);
    },
    stderr: () => {},
    stdout: (s) => out.push(s),
  });

  return { code, out: out.join(""), root, spawned };
}

it("runs ci.checks after the gates, in config order, each timed and counted in the summary", () => {
  const run = withChecks({
    "infra-gen-cli": { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }), status: null },
    "scripts/check/product-tree.ts": { status: 1, stdout: "projects/x has no project.yaml\n" },
  });

  expect(run.out).toBe(
    "ci: check ok (0.5s)\nci: fmt ok (0.5s)\nci: typecheck 2 configs (0.5s)\nci: 4 tests passed (0.5s)\n" +
      "ci: container-images ok (0.5s)\n" +
      "ci: product-tree failed (exit 1) (0.5s)\nprojects/x has no project.yaml\n" +
      "ci: infra-gen failed (infra-gen-cli not found)\n" +
      "ci: check ok · fmt ok · typecheck 2 configs · 4 tests passed · container-images ok · " +
      "product-tree failed (exit 1) · infra-gen failed (infra-gen-cli not found)\n",
  );
  expect(run.code).toBe(1);
  expect(run.spawned.map((call) => [call.cmd, ...call.args])).toStrictEqual([
    ["bun", "scripts/check/container-images.ts"],
    ["bun", "scripts/check/product-tree.ts"],
    ["infra-gen-cli", "--check"],
  ]);
  expect(run.spawned.every((call) => call.cwd === run.root)).toBe(true);
});

it("passing checks leave the exit code 0", () => {
  expect(withChecks({}).code).toBe(0);
});

it("reads ci.checks from the config when no deps give them", async () => {
  const root = plant({
    "workerstack.config.ts": 'export default { packs: [], ci: { checks: { "a-check": ["tool", "x"] } } };\n',
  });

  const seen: string[] = [];

  const { code, out } = await ciFromConfig(root, {
    spawn: (cmd, args) => {
      seen.push([cmd, ...args].join(" "));

      return spawnReply();
    },
  });

  expect(code).toBe(0);
  expect(seen).toStrictEqual(["tool x"]);
  expect(out).toContain("ci: a-check ok (0.0s)\n");
});

it("wait <branch> waits on that branch, and wait a b is refused with exit 2", async () => {
  const seen: string[][] = [];
  const err: string[] = [];

  function git(args: string[]) {
    return (seen.push(args), { code: 1, stderr: "no git", stdout: "" });
  }

  function run(argv: string[]) {
    return main(argv, { cwd: "/repo", git, stderr: (s) => err.push(s), stdout: () => {} });
  }

  expect(await run(["wait", "feat/x"])).toBe(4);
  expect(seen[0]).toStrictEqual(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/feat/x"]);
  expect(err.join("")).toBe("repo ci wait: feat/x is not on origin; push it first\n");
  err.length = 0;
  seen.length = 0;
  expect(await run(["wait", "a", "b"])).toBe(2);
  expect(err.join("")).toBe("repo ci: wait takes at most one branch\n");
  expect(seen).toStrictEqual([]);
});
