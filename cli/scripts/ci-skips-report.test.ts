import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanTemps, read, tempDir, write } from "./__fixtures__/turn-repo.ts";
import { skippedIds, writeReport } from "./ci-skips.ts";

afterEach(cleanTemps);

function vitestJson(name: string, results: [string, string][]) {
  return JSON.stringify({
    testResults: [{ assertionResults: results.map(([fullName, status]) => ({ fullName, status })), name }],
  });
}

it(
  "ids are the posix path from the root, a separator and the " +
    "full name, for tests that did not run, sorted and unique",
  () => {
    const root = "/work/app";

    const json = JSON.parse(
      vitestJson("/work/app/cli/b.test.ts", [
        ["z skipped", "skipped"],
        ["a pending", "pending"],
        ["a pending", "pending"],
        ["m todo", "todo"],
        ["ran", "passed"],
        ["broke", "failed"],
      ]),
    );

    expect(skippedIds(json, root)).toStrictEqual([
      "cli/b.test.ts > a pending",
      "cli/b.test.ts > m todo",
      "cli/b.test.ts > z skipped",
    ]);
  },
);

it("a windows report with backslashed absolute paths gives the posix id", () => {
  const json = JSON.parse(vitestJson("C:\\work\\app\\cli\\a.test.ts", [["reads a symlink", "skipped"]]));
  expect(skippedIds(json, "C:\\work\\app")).toStrictEqual(["cli/a.test.ts > reads a symlink"]);
});

it("a json that is not a vitest report has no skips", () => {
  expect(skippedIds({ nope: 1 }, "/x")).toStrictEqual([]);
});

it("writeReport writes the os and the ids, and an absent vitest json gives an empty list", () => {
  const dir = tempDir("workerstack-skips-");
  write(dir, { "v.json": vitestJson(path.join(dir, "a.test.ts"), [["t", "skipped"]]) });
  writeReport(path.join(dir, "out.json"), path.join(dir, "v.json"), dir);
  expect(JSON.parse(read(dir, "out.json"))).toStrictEqual({
    durations: {},
    os: process.platform,
    skipped: ["a.test.ts > t"],
  });
  writeReport(path.join(dir, "none.json"), path.join(dir, "missing.json"), dir);
  expect(JSON.parse(read(dir, "none.json"))).toStrictEqual({ durations: {}, os: process.platform, skipped: [] });
  fs.writeFileSync(path.join(dir, "bad.json"), "{ nope");
  writeReport(path.join(dir, "bad-out.json"), path.join(dir, "bad.json"), dir);
  expect(JSON.parse(read(dir, "bad-out.json"))).toStrictEqual({ durations: {}, os: process.platform, skipped: [] });
});

function timed(name: string, startTime: number, endTime: number) {
  return { assertionResults: [], endTime, name, startTime };
}

it("writeReport adds the whole ms of endTime - startTime per file, by posix path from the root, keys sorted", () => {
  const dir = tempDir("workerstack-skips-");
  write(dir, {
    "v.json": JSON.stringify({
      testResults: [
        timed(path.join(dir, "cli", "z.test.ts"), 1000, 1500.4),
        timed(path.join(dir, "a.test.ts"), 2000, 13_850.6),
        { assertionResults: [], name: path.join(dir, "untimed.test.ts") },
      ],
    }),
  });
  writeReport(path.join(dir, "out.json"), path.join(dir, "v.json"), dir);

  const written = JSON.parse(read(dir, "out.json")) /* writeReport wrote durations as numbers */ as {
    durations: Record<string, number>;
  };

  expect(written.durations).toStrictEqual({ "a.test.ts": 11_851, "cli/z.test.ts": 500 });
  expect(Object.keys(written.durations)).toStrictEqual(["a.test.ts", "cli/z.test.ts"]);
});
