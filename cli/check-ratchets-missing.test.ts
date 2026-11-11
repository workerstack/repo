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

const floor = (branches: number) => ({ statements: 80, branches, functions: 90 });
const job = "cli/scripts/job.ts";

describe("ratchetProblems, files gone, unreadable or oddly shaped here", () => {
  const main = {
    [FLOORS]: { [job]: floor(HIGH) },
    [job]: "export {};\n",
    [FAILURES]: ["a > b"],
    [BASELINE]: { "a.ts": { r: 2 } },
  };

  it("reads a deleted floors, list and baseline file as empty", () => {
    const dir = repoOnMain(main);
    for (const rel of [FLOORS, FAILURES, BASELINE]) fs.rmSync(path.join(dir, rel));
    expect(ratchetProblems(dir)).toStrictEqual([
      `${FLOORS}: ${job} has no floor but main has one and the file exists; restore it`,
    ]);
  });

  it("reads floors that are not JSON as empty, and a baseline that dropped the rule as zero", () => {
    const dir = repoOnMain(main);
    write(dir, { [FLOORS]: "{", [BASELINE]: { "a.ts": {} } });
    expect(ratchetProblems(dir)).toStrictEqual([
      `${FLOORS}: ${job} has no floor but main has one and the file exists; restore it`,
    ]);
  });

  it("fails a metric that lost its floor, and skips main rows that are no table", () => {
    const dir = repoOnMain({ ...main, [FLOORS]: { [job]: floor(HIGH), "x.ts": 5 } });
    write(dir, { [FLOORS]: { [job]: { statements: 80, functions: 90 } } });
    expect(ratchetProblems(dir)).toStrictEqual([
      `${FLOORS}: ${job} branches has no floor but main has ${HIGH}; restore it`,
    ]);
  });
});
