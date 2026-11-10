import { afterEach, expect, it } from "vitest";
import { ci, bad, plant } from "./fixtures/ci-run.ts";
import { cleanTemps, tempDir, write } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

it("every gate passing prints each gate line, then the summary, and exits 0", () => {
  const run = ci(plant());
  expect(run).toMatchObject({
    code: 0,
    out:
      "ci: check ok (0.5s)\nci: fmt ok (0.5s)\nci: typecheck 2 configs (0.5s)\nci: 4 tests passed (0.5s)\n" +
      "ci: check ok · fmt ok · typecheck 2 configs · 4 tests passed\n",
    err: "",
  });
  expect(run.calls).toEqual({
    repo: ["check", "fmt --check"],
    tsc: ["--noEmit -p tsconfig.json", "--noEmit -p packages/a/tsconfig.json"],
    vitest: ["run --coverage"],
    turbo: [],
  });
});

const FAILING = {
  check: { label: "check failed", fail: { check: bad("bad manifest\n") }, shown: "bad manifest\n" },
  fmt: { label: "fmt failed", fail: { fmt: bad("src/a.ts\n") }, shown: "src/a.ts\n" },
  typecheck: {
    label: "typecheck failed (packages/a/tsconfig.json)",
    fail: { "packages/a/tsconfig.json": bad("a.ts(1,1): error TS2322") },
    shown: "a.ts(1,1): error TS2322\n",
  },
  tests: {
    label: "tests failed (1 failed, 3 passed)",
    fail: { tests: { code: 1, stdout: " Tests  1 failed | 3 passed (4)\n", stderr: "AssertionError\n" } },
    shown: " Tests  1 failed | 3 passed (4)\nAssertionError\n",
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
    expect(run.calls.vitest).toEqual(["run --coverage"]);
    expect(lines.at(-2)).toContain(label);
  },
);

it("a test run that fails without counts says only that it failed", () => {
  const run = ci(plant(), [], { tests: { code: 1, stdout: "", stderr: "boom\n" } });
  expect(run.out).toContain("ci: tests failed (0.5s)\nboom\n");
  expect(run.code).toBe(1);
});

it("typechecks every tsconfig in the root and each package, not fixtures or installs", () => {
  const root = plant({
    "tsconfig.build.json": "{}\n",
    "tsconfig.src.json": "{}\n",
    "tsconfig-notes.txt": "",
    "package.json": '{ "name": "app", "workspaces": ["packages/*", "fixtures/*", "vendor/*/*"] }\n',
    "packages/a/tsconfig.test.json": "{}\n",
    "fixtures/f/package.json": '{ "name": "f" }\n',
    "fixtures/f/tsconfig.json": "{}\n",
    "vendor/x/y/package.json": '{ "name": "y" }\n',
    [`vendor/x/y/${"node"}_modules/z/tsconfig.json`]: "{}\n",
    [`vendor/${"node"}_modules/w/package.json`]: '{ "name": "w" }\n',
    [`vendor/${"node"}_modules/w/tsconfig.json`]: "{}\n",
  });
  const run = ci(root);
  expect(run.calls.tsc.map((call) => call.replace("--noEmit -p ", ""))).toEqual([
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
  expect(run.calls.tsc).toEqual([]);
});

it("when vitest is absent the tests gate is skipped and the run still passes", () => {
  const run = ci(plant(), [], { tests: null });
  expect(run.code).toBe(0);
  expect(run.out).toContain("ci: tests skipped (no vitest in .)\n");
  expect(run.out).toContain(" · tests skipped (no vitest in .)\n");
});

it("a repo with no tsconfig skips the typecheck gate without a time", () => {
  const root = tempDir("workerstack-ci-bare-");
  write(root, { "workerstack.config.ts": "export default {};\n", "package.json": '{ "name": "app" }\n' });
  const run = ci(root);
  expect(run.code).toBe(0);
  expect(run.out).toContain("ci: typecheck skipped (no tsconfig.json)\n");
  expect(run.out).toContain(" · typecheck skipped (no tsconfig.json) · ");
  expect(run.calls.tsc).toEqual([]);
});

it("outside a repo the run is refused", () => {
  const run = ci(tempDir("workerstack-ci-empty-"));
  expect(run.code).toBe(1);
  expect(run.err).toMatch(/^repo ci: no workerstack\.config\.ts in .* or any parent; run `bun repo init`\n$/);
});
