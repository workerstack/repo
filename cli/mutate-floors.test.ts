import { expect, it } from "vitest";
import { fakes, rawReport, sim } from "./fixtures/mutate-fakes.ts";
import { runMutate } from "./mutate.ts";
import { packageOf, percentOf, tally } from "./mutate-floors.ts";

const survivor = { line: 1, column: 1, mutator: "m", status: "Survived" } as const;

it("scores killed over killed plus survivors, so errors, ignored and compile errors weigh nothing", () => {
  const files = {
    "a.ts": { killed: 8, survivors: [survivor, { ...survivor, status: "NoCoverage" as const }] },
  };
  const [score] = [...tally(files, []).values()];
  expect(percentOf(score ?? { killed: 0, survivors: 0 })).toBe(80);
});

it("scores a package with no scored mutant as 100", () => {
  expect(percentOf({ killed: 0, survivors: 0 })).toBe(100);
});

it("attributes a file to the deepest package dir holding it, else the root", () => {
  const packages = ["packages/a", "packages/a/inner", "packages/ab"];
  expect(packageOf("packages/a/src/x.ts", packages)).toBe("packages/a");
  expect(packageOf("packages/a/inner/x.ts", packages)).toBe("packages/a/inner");
  expect(packageOf("packages/ab/x.ts", packages)).toBe("packages/ab");
  expect(packageOf("packages/other/x.ts", packages)).toBe(".");
  const files = { "packages/a/x.ts": { killed: 1, survivors: [] }, "y.ts": { killed: 3, survivors: [survivor] } };
  expect(Object.fromEntries(tally(files, packages))).toEqual({
    "packages/a": { killed: 1, survivors: 0 },
    ".": { killed: 3, survivors: 1 },
  });
});

const TRACKED = ["packages/a/src/x.ts", "src/y.ts"];
const FILES = { "packages/a/src/x.ts": "x\n", "src/y.ts": "y\n" };
const REPORT = ".tmp/repo/mutation/report.json";

function unsharded(floors: Record<string, number> | string | null) {
  const report = rawReport({
    "packages/a/src/x.ts": ["Killed", "Killed", "Timeout", "Survived", "CompileError"],
    "src/y.ts": ["Killed", "NoCoverage"],
  });
  const config = { root: "/repo", mutate: ["**/src/*.ts"], floors: "mf.json" };
  const f = fakes(sim({ tracked: TRACKED, sources: FILES, config, stryker: { code: 0, output: "", report } }), [
    "packages/a",
  ]);
  if (floors !== null) f.files.set("/repo/mf.json", typeof floors === "string" ? floors : JSON.stringify(floors));
  return f;
}

it("prints each package's score against its floor and passes at or above every floor", async () => {
  const f = unsharded({ ".": 50, "packages/a": 75 });
  expect(await runMutate([], f.deps)).toBe(0);
  expect(f.out.slice(1)).toEqual([
    "mutate: 2 files, shard 1/1\n",
    `mutate: . 50.00% (floor 50), 1 survivor in ${REPORT}\n`,
    `mutate: packages/a 75.00% (floor 75), 1 survivor in ${REPORT}\n`,
  ]);
  expect(f.err).toEqual([]);
  expect(JSON.parse(f.files.get(`/repo/${REPORT}`) ?? "")).toMatchObject({ shard: { index: 1, total: 1 } });
});

it("fails a package below its floor, naming the floors file and the report", async () => {
  const f = unsharded({ ".": 51, "packages/a": 75 });
  expect(await runMutate([], f.deps)).toBe(1);
  expect(f.err).toEqual([
    `repo mutate: . scored 50.00%, below its floor of 51 in mf.json; see the survivors in ${REPORT}\n`,
  ]);
});

it("holds a package with no floor to none, and runs with no floors file", async () => {
  const f = unsharded(null);
  expect(await runMutate([], f.deps)).toBe(0);
  expect(f.out[2]).toBe(`mutate: . 50.00% (no floor), 1 survivor in ${REPORT}\n`);
});

it("refuses a floors file that is not a table of numbers", async () => {
  const bad = unsharded('{ ".": "high" }');
  expect(await runMutate([], bad.deps)).toBe(1);
  expect(bad.err.join("")).toMatch(/^repo mutate: mf.json is not a floors file: .+\n$/);
  const json = unsharded("{");
  expect(await runMutate([], json.deps)).toBe(1);
  expect(json.err.join("")).toContain("mf.json is not a floors file");
});

it("treats --shard 1/1 as the whole run and checks no floor for a real shard", async () => {
  const whole = unsharded({ ".": 99 });
  expect(await runMutate(["--shard", "1/1"], whole.deps)).toBe(1);
  const part = unsharded({ ".": 99 });
  expect(await runMutate(["--shard", "1/2"], part.deps)).toBe(0);
  expect(part.err).toEqual([]);
});
