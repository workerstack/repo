import { afterEach, expect, it } from "vitest";

import { ciCommand } from "./ci-command.ts";
import { ci, plant } from "./fixtures/ci-run.ts";
import { cleanTemps } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

it("times <dir> parses to the times command, and times with no or two dirs is the usage", () => {
  expect(ciCommand(["times", "reports"])).toStrictEqual({ dir: "reports", kind: "times" });
  expect(ciCommand(["times"])).toStrictEqual({ kind: "usage" });
  expect(ciCommand(["times", "a", "b"])).toStrictEqual({ kind: "usage" });
});

it("merge <dir> parses to the merge command, and merge with no or two dirs is the usage", () => {
  expect(ciCommand(["merge", "blobs"])).toStrictEqual({ dir: "blobs", kind: "merge" });
  expect(ciCommand(["merge"])).toStrictEqual({ kind: "usage" });
  expect(ciCommand(["merge", "a", "b"])).toStrictEqual({ kind: "usage" });
});

it("--shard parses with or without --no-coverage", () => {
  expect(ciCommand(["--shard", "1/2"])).toStrictEqual({ coverage: true, kind: "gates", shard: "1/2" });
  expect(ciCommand(["--no-coverage", "--shard", "2/2"])).toStrictEqual({
    coverage: false,
    kind: "gates",
    shard: "2/2",
  });
});

it("times <dir> runs from main and writes the table at the root", () => {
  const root = plant({ "reports/ci-report-linux.json": '{"durations":{"a.test.ts":4},"os":"linux","skipped":[]}' });
  const run = ci(root, ["times", "reports"]);
  expect(run).toMatchObject({
    code: 0,
    err: "",
    out: "repo ci times: wrote .repo/test-times.json (linux 1 files)\n",
  });
});
