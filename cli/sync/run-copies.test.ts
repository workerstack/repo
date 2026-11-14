import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { put, tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { processRuns, removeStaleRunCopies } from "./run-copies.ts";

useTempDirs();

const DEAD = 41;
const LIVE = 42;

/** The pid of a process that ran and exited, so no process holds it now. */
function exitedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

/** The four run copy names for `pid`: oxlint and knip, each in the jsonc and the old json name. */
function names(pid: number): string[] {
  return [
    `.oxlintrc.unskipped-${pid}.jsonc`,
    `.oxlintrc.unskipped-${pid}.json`,
    `knip.unignored-${pid}.jsonc`,
    `knip.unignored-${pid}.json`,
  ];
}

it("removes the run copies of a stopped process in both names, and keeps a live one's, other names and dirs", () => {
  const root = tempDir("run-copies-");

  for (const name of [...names(DEAD), ...names(LIVE), "knip.unignored-x.jsonc", ".oxlintrc.jsonc"])
    put(root, name, "{}\n");
  fs.mkdirSync(path.join(root, `knip.unignored-${DEAD}.json.d`));
  fs.mkdirSync(path.join(root, `.oxlintrc.unskipped-${DEAD}0.jsonc`));

  expect(removeStaleRunCopies(root, (pid) => pid === LIVE)).toStrictEqual(names(DEAD).toSorted());
  expect(fs.readdirSync(root).toSorted()).toStrictEqual(
    [
      ...names(LIVE),
      "knip.unignored-x.jsonc",
      ".oxlintrc.jsonc",
      `knip.unignored-${DEAD}.json.d`,
      `.oxlintrc.unskipped-${DEAD}0.jsonc`,
    ].toSorted(),
  );
  expect(removeStaleRunCopies(root, (pid) => pid === LIVE)).toStrictEqual([]);
});

it("reads a process as running for this one and another user's, and stopped once it exited", () => {
  const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });

  expect(processRuns(process.pid)).toBe(true);
  expect(processRuns(exitedPid())).toBe(false);
  expect(
    processRuns(LIVE, () => {
      throw denied;
    }),
  ).toBe(true);
});
