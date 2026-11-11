import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ratchetProblems } from "./check-ratchets.ts";
import { removePlanted, repoOnMain, write } from "./fixtures/planted-repo.ts";

afterEach(removePlanted);

const FLOORS = "coverage-floors.json";
const FAILURES = "known-failures.json";
const BASELINE = ".repo/lint-baseline.json";
const HIGH = 61;

function floor(branches: number) {
  return { branches, functions: 90, statements: 80 };
}
const JOB = "cli/scripts/job.ts";

describe("ratchetProblems, files gone, unreadable or oddly shaped here", () => {
  const main = {
    [BASELINE]: { "a.ts": { r: 2 } },
    [FAILURES]: ["a > b"],
    [FLOORS]: { [JOB]: floor(HIGH) },
    [JOB]: "export {};\n",
  };

  it("reads a deleted floors, list and baseline file as empty", () => {
    const dir = repoOnMain(main);
    for (const rel of [FLOORS, FAILURES, BASELINE]) fs.rmSync(path.join(dir, rel));
    expect(ratchetProblems(dir)).toStrictEqual([
      `${FLOORS}: ${JOB} has no floor but main has one and the file exists; restore it`,
    ]);
  });

  it("reads floors that are not JSON as empty, and a baseline that dropped the rule as zero", () => {
    const dir = repoOnMain(main);
    write(dir, { [BASELINE]: { "a.ts": {} }, [FLOORS]: "{" });
    expect(ratchetProblems(dir)).toStrictEqual([
      `${FLOORS}: ${JOB} has no floor but main has one and the file exists; restore it`,
    ]);
  });

  it("fails a metric that lost its floor, and skips main rows that are no table", () => {
    const dir = repoOnMain({ ...main, [FLOORS]: { [JOB]: floor(HIGH), "x.ts": 5 } });
    write(dir, { [FLOORS]: { [JOB]: { functions: 90, statements: 80 } } });
    expect(ratchetProblems(dir)).toStrictEqual([
      `${FLOORS}: ${JOB} branches has no floor but main has ${HIGH}; restore it`,
    ]);
  });
});
