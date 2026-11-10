import { afterEach, expect, it } from "vitest";
import { main } from "./ci.ts";
import type { Captured } from "./lint.ts";
import { OK, plant } from "./fixtures/ci-run.ts";
import { cleanTemps } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const NO_FILES: Captured = { code: 0, stdout: "No test files found, exiting with code 0\n", stderr: "" };
const NO_FILES_FAILED: Captured = { code: 1, stdout: "No test files found, exiting with code 1\n", stderr: "" };

/** `repo ci` in a plant with `files`, vitest answering `vitest`; what it ran and printed. */
function run(files: Record<string, string>, vitest: Captured) {
  const calls: string[] = [];
  const out: string[] = [];
  const code = main([], {
    cwd: plant(files),
    stdout: (s) => out.push(s),
    stderr: () => undefined,
    packs: [],
    bins: {
      tsc: () => OK,
      vitest: (args) => {
        calls.push(args.join(" "));
        return vitest;
      },
    },
    repo: () => OK,
    cargo: () => ({ status: 0, stdout: "", stderr: "", missing: false }),
  });
  return { code, calls, out: out.join("") };
}

it("with a root Cargo.toml vitest passes with no tests and the gate says it skipped", () => {
  const result = run({ "Cargo.toml": "[workspace]\n" }, NO_FILES);
  expect(result.calls).toEqual(["run --coverage --passWithNoTests"]);
  expect(result.out).toContain("ci: tests skipped (no test files)");
});

it("without a root Cargo.toml vitest gets no flag and a repo with no tests still fails", () => {
  const result = run({}, NO_FILES_FAILED);
  expect(result.calls).toEqual(["run --coverage"]);
  expect(result.code).toBe(1);
  expect(result.out).toContain("ci: tests failed");
});
