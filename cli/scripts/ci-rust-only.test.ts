import { afterEach, expect, it } from "vitest";

import { OK, plant } from "./__fixtures__/ci-run.ts";
import { cleanTemps } from "./__fixtures__/turn-repo.ts";
import { main } from "./ci.ts";
import type { Captured } from "./lint.ts";

afterEach(cleanTemps);

const NO_FILES: Captured = { code: 0, stderr: "", stdout: "No test files found, exiting with code 0\n" };
const NO_FILES_FAILED: Captured = { code: 1, stderr: "", stdout: "No test files found, exiting with code 1\n" };

/** `repo ci` in a plant with `files`, vitest answering `vitest`; what it ran and printed. */
function run(files: Record<string, string>, vitest: Captured) {
  const calls: string[] = [];
  const out: string[] = [];

  const code = main([], {
    bins: {
      tsc: () => OK,
      vitest: (args) => {
        calls.push(args.join(" "));

        return vitest;
      },
    },
    cargo: () => ({ missing: false, status: 0, stderr: "", stdout: "" }),
    cwd: plant(files),
    packs: [],
    repo: () => OK,
    stderr: () => {},
    stdout: (s) => out.push(s),
  });

  return { calls, code, out: out.join("") };
}

it("with a root Cargo.toml vitest passes with no tests and the gate says it skipped", () => {
  const result = run({ "Cargo.toml": "[workspace]\n" }, NO_FILES);
  expect(result.calls).toStrictEqual(["run --coverage --passWithNoTests"]);
  expect(result.out).toContain("ci: tests skipped (no test files)");
});

it("without a root Cargo.toml vitest gets no flag and a repo with no tests still fails", () => {
  const result = run({}, NO_FILES_FAILED);
  expect(result.calls).toStrictEqual(["run --coverage"]);
  expect(result.code).toBe(1);
  expect(result.out).toContain("ci: tests failed");
});
