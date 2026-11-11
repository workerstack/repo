import path from "node:path";

import { expect, it } from "vitest";

import { at, fakes, SHA, sim, type Fakes } from "./__fixtures__/mutate-fakes.ts";
import { OTHER, plantReports, survivor } from "./__fixtures__/shard-reports.ts";
import type { ShardReport } from "./mutate-report.ts";
import { runMutate } from "./mutate.ts";

function shard(index: number, total: number, files: ShardReport["files"]): ShardReport {
  return { files, head: SHA, shard: { index, total }, tool: "stryker" };
}

/** Reports in /repo/reports; shard 1 killed 9 and let 1 live, shard 2 killed 18 and let 2 live: 27 of 30, 90%. */
function pair(): ShardReport[] {
  return [
    shard(1, 2, { "src/a.ts": { killed: 9, survivors: [survivor] } }),
    shard(2, 2, { "packages/p/b.ts": { killed: 18, survivors: [survivor, survivor] } }),
  ];
}

function planted(reports: ShardReport[], floors?: Record<string, number>): Fakes {
  const f = fakes(undefined, ["packages/p"]);
  plantReports(f, reports);
  if (floors !== undefined) f.files.set(at("mutation-floors.json"), JSON.stringify(floors));
  return f;
}

it("merges the shards, scores each package against its floor and passes at or above them", async () => {
  const f = planted(pair(), { ".": 89, "packages/p": 85 });
  expect(await runMutate(["check", "reports"], f.deps)).toBe(0);
  expect(f.out).toStrictEqual(["mutate: 2 shards of 09ed564; . 90.00% (floor 89); packages/p 90.00% (floor 85)\n"]);
  expect(f.err).toStrictEqual([]);
});

it("fails a package below its floor and names the report dir", async () => {
  const f = planted(pair(), { ".": 91 });
  expect(await runMutate(["check", "reports"], f.deps)).toBe(1);
  expect(f.err).toStrictEqual([
    "repo mutate: . scored 90.00%, below its floor of 91 in mutation-floors.json; see the survivors in reports\n",
  ]);
  expect(f.files.get(at("mutation-floors.json"))).toBe(JSON.stringify({ ".": 91 }));
});

it("scores a package with no floor against none", async () => {
  const f = planted(pair());
  expect(await runMutate(["check", "reports"], f.deps)).toBe(0);
  expect(f.out[0]).toBe("mutate: 2 shards of 09ed564; . 90.00% (no floor); packages/p 90.00% (no floor)\n");
});

it("refuses a missing shard, naming it", async () => {
  const f = planted([shard(1, 4, {}), shard(4, 4, {})]);
  expect(await runMutate(["check", "reports"], f.deps)).toBe(1);
  expect(f.err.join("")).toBe(
    "repo mutate: reports is missing shards 2, 3 of 4; download every shard's report first\n",
  );
  const one = planted([shard(2, 2, {})]);
  await runMutate(["check", "reports"], one.deps);
  expect(one.err.join("")).toBe("repo mutate: reports is missing shard 1 of 2; download every shard's report first\n");
});

it("refuses reports of different heads, different shard counts and a shard twice", async () => {
  const heads = planted([shard(1, 2, {}), { ...shard(2, 2, {}), head: OTHER }]);
  await runMutate(["check", "reports"], heads.deps);
  expect(heads.err.join("")).toBe("repo mutate: reports holds shards of 09ed564 and 1a2b3c4; use one run's reports\n");
  const totals = planted([shard(1, 2, {}), shard(2, 8, {})]);
  await runMutate(["check", "reports"], totals.deps);
  expect(totals.err.join("")).toBe("repo mutate: reports mixes runs of 2 and 8 shards; use one run's reports\n");
  const twice = planted([shard(1, 2, {}), shard(1, 2, {})]);
  await runMutate(["check", "reports"], twice.deps);
  expect(twice.err.join("")).toBe("repo mutate: reports holds shard 1 twice; use one run's reports\n");
});

it("names a bad file and the reason, and an empty or missing dir", async () => {
  const bad = planted(pair());
  bad.files.set(at("reports", "mutation-2.json"), JSON.stringify({ head: 1 }));
  expect(await runMutate(["check", "reports"], bad.deps)).toBe(1);
  expect(bad.err.join("")).toMatch(
    new RegExp(
      `^repo mutate: ${path.join("reports", "mutation-2.json").replaceAll("\\", "\\\\")} is not a mutation ` +
        `report: .*head: .+\n$`,
    ),
  );
  const text = planted(pair());
  text.files.set(at("reports", "mutation-2.json"), "{");
  await runMutate(["check", "reports"], text.deps);
  expect(text.err.join("")).toContain(`${path.join("reports", "mutation-2.json")} is not a mutation report: `);
  const none = planted([]);
  expect(await runMutate(["check", "reports"], none.deps)).toBe(1);
  expect(none.err.join("")).toBe(
    "repo mutate: reports holds no mutation report; run `repo mutate --shard i/n --report " +
      "reports/mutation-i.json` first\n",
  );
});

it("ignores files in the dir that are not JSON", async () => {
  const f = planted(pair(), { ".": 89 });
  f.files.set(at("reports", "notes.txt"), "hello");
  expect(await runMutate(["check", "reports"], f.deps)).toBe(0);
});

it("raises a floor to the whole score, adds a package, and never lowers one", async () => {
  const f = planted(pair(), { ".": 85, other: 70 });
  expect(await runMutate(["check", "reports", "--write"], f.deps)).toBe(0);
  expect(f.out).toStrictEqual([
    "mutate: 2 shards of 09ed564; . 90.00% (floor 85 → 90); packages/p 90.00% (floor new → 90); wrote " +
      "mutation-floors.json\n",
  ]);
  expect(JSON.parse(f.files.get(at("mutation-floors.json")) ?? "")).toStrictEqual({
    ".": 90,
    other: 70,
    "packages/p": 90,
  });
});

it("floors a fractional score, and writes nothing when no floor changes", async () => {
  const f = planted([shard(1, 1, { "a.ts": { killed: 5, survivors: [survivor, survivor, survivor] } })], { ".": 62 });
  expect(await runMutate(["check", "reports", "--write"], f.deps)).toBe(0);
  expect(f.out[0]).toBe("mutate: 1 shard of 09ed564; . 62.50% (floor 62)\n");
  expect(f.files.get(at("mutation-floors.json"))).toBe(JSON.stringify({ ".": 62 }));
});

it("writes nothing and fails when a package is below its floor", async () => {
  const f = planted(pair(), { ".": 95, "packages/p": 10 });
  expect(await runMutate(["check", "reports", "--write"], f.deps)).toBe(1);
  expect(f.files.get(at("mutation-floors.json"))).toBe(JSON.stringify({ ".": 95, "packages/p": 10 }));
  expect(f.out.join("")).not.toContain("wrote");
});

it("prints a config's errors and an unreadable floors file instead of scoring", async () => {
  const config = planted(pair());
  const state = sim({ config: ["workerstack.config.ts: no default export"] });
  const broken = fakes(state);
  expect(await runMutate(["check", "reports"], broken.deps)).toBe(1);
  expect(broken.err.join("")).toBe("repo mutate: workerstack.config.ts: no default export\n");
  config.files.set(at("mutation-floors.json"), "[1]");
  expect(await runMutate(["check", "reports"], config.deps)).toBe(1);
  expect(config.err.join("")).toMatch(/^repo mutate: mutation-floors.json is not a floors file: .+\n$/);
});

it("names a report that is no object, and a listed report that cannot be read", async () => {
  const flat = planted(pair());
  flat.files.set(at("reports", "mutation-2.json"), "5");
  await runMutate(["check", "reports"], flat.deps);
  expect(flat.err.join("")).toMatch(/mutation-2.json is not a mutation report: report: .+\n$/);
  const gone = planted(pair());
  const read = gone.deps.fs.read;
  gone.deps.fs.read = (file) => (file.endsWith("mutation-2.json") ? null : read(file));
  await runMutate(["check", "reports"], gone.deps);
  expect(gone.err.join("")).toContain(`${path.join("reports", "mutation-2.json")} is not a mutation report: `);
});
