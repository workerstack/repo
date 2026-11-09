import { afterEach, expect, it } from "vitest";
import { main, type CiDeps } from "./ci.ts";
import { cleanTemps, tempDir, write } from "./fixtures/turn-repo.ts";
import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

const OK: Captured = { code: 0, stdout: "", stderr: "" };
const bad = (stdout: string): Captured => ({ code: 1, stdout, stderr: "" });
const PASSED: Captured = { ...OK, stdout: " Tests  4 passed (4)\n" };

type Calls = { repo: string[]; tsc: string[]; vitest: string[] };

/** A tiny repo with a root tsconfig and one package; `files` add to it. */
function plant(files: Record<string, string> = {}): string {
  const root = tempDir("workerstack-ci-");
  write(root, {
    "workerstack.config.ts": "export default {};\n",
    "package.json": '{ "name": "app", "workspaces": ["packages/*"] }\n',
    "tsconfig.json": "{}\n",
    "packages/a/package.json": '{ "name": "a" }\n',
    "packages/a/tsconfig.json": "{}\n",
    ...files,
  });
  return root;
}

/** Runs `repo ci` in `root` against fakes whose results `fail` overrides by name; each gate takes half a second. */
function ci(root: string, argv: string[] = [], fail: Partial<Record<string, Captured | null>> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Calls = { repo: [], tsc: [], vitest: [] };
  let clock = 0;
  const bins: Bins = {
    tsc: (args) => {
      calls.tsc.push(args.join(" "));
      return fail[args.at(-1) ?? ""] ?? OK;
    },
    vitest: (args) => {
      calls.vitest.push(args.join(" "));
      return fail.tests === undefined ? PASSED : fail.tests;
    },
  };
  const deps: CiDeps = {
    cwd: root,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    now: () => (clock += 500),
    bins,
    repo: (args) => {
      calls.repo.push(args.join(" "));
      const [name = ""] = args;
      return fail[name] ?? OK;
    },
  };
  return { code: main(argv, deps), out: out.join(""), err: err.join(""), calls };
}

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

it("an argument is refused with the one-file pattern, and no gate runs", () => {
  const run = ci(plant(), ["src/a.test.ts"]);
  expect(run).toMatchObject({
    code: 1,
    out: "",
    err: "repo ci: takes no arguments; run one test file with `bun run test src/a.test.ts`\n",
    calls: { repo: [], tsc: [], vitest: [] },
  });
});

it("outside a repo the run is refused", () => {
  const run = ci(tempDir("workerstack-ci-empty-"));
  expect(run.code).toBe(1);
  expect(run.err).toMatch(/^repo ci: no workerstack\.config\.ts in .* or any parent; run `bun repo init`\n$/);
});
