import { expect, it } from "vitest";
import { at, fakes } from "./fixtures/mutate-fakes.ts";
import { runMutate } from "./mutate.ts";
import type { ShardReport } from "./mutate-report.ts";

const HEAD = "09ed564aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "1a2b3c4bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const survivor = { line: 1, column: 1, mutator: "m", status: "Survived" } as const;

type Kind = { tool: ShardReport["tool"]; total: number };
const STRYKER: Kind = { tool: "stryker", total: 8 };

function shard(index: number, kind: Kind, files: ShardReport["files"] = {}): ShardReport {
  return { tool: kind.tool, head: HEAD, shard: { index, total: kind.total }, files };
}

const RUST: Kind = { tool: "cargo-mutants", total: 4 };
const rust = (index: number, files: ShardReport["files"] = {}) => shard(index, RUST, files);

/** 8 Stryker shards of 10 mutants (9 killed) and 4 cargo-mutants shards of one crate (3 killed, 1 lives each). */
function both(): ShardReport[] {
  const stryker = Array.from({ length: 8 }, (_, i) =>
    shard(i + 1, STRYKER, { [`src/f${i}.ts`]: { killed: 9, survivors: [survivor] } }),
  );
  const cargo = [1, 2, 3, 4].map((i) =>
    rust(i, {
      [`crates/a/src/f${i}.rs`]: { killed: 3, survivors: [survivor] },
    }),
  );
  return [...stryker, ...cargo];
}

it("merges 8 Stryker and 4 cargo-mutants shards of one head and scores both", async () => {
  const f = fakes(undefined, ["crates/a"]);
  both().forEach((report, i) => f.files.set(at("reports", `mutation-${i + 1}.json`), JSON.stringify(report)));
  expect(await runMutate(["check", "reports"], f.deps)).toBe(0);
  expect(f.out).toEqual(["mutate: 12 shards of 09ed564; . 90.00% (no floor); crates/a 75.00% (no floor)\n"]);
});

it("names the tool of a missing, repeated or mixed-count shard only when the dir holds both tools", async () => {
  const run = async (reports: ShardReport[]) => {
    const f = fakes(undefined, ["crates/a"]);
    reports.forEach((report, i) => f.files.set(at("reports", `mutation-${i + 1}.json`), JSON.stringify(report)));
    await runMutate(["check", "reports"], f.deps);
    return f.err.join("");
  };
  const two: Kind = { tool: "stryker", total: 2 };
  const stryker = [shard(1, two), shard(2, two)];
  expect(await run([...stryker, rust(1), rust(2), rust(4)])).toBe(
    "repo mutate: reports is missing cargo-mutants shard 3 of 4; download every shard's report first\n",
  );
  expect(await run([...stryker, rust(1), rust(1), rust(2), rust(3), rust(4)])).toBe(
    "repo mutate: reports holds cargo-mutants shard 1 twice; use one run's reports\n",
  );
  expect(await run([...stryker, rust(1), { ...rust(2), shard: { index: 2, total: 8 } }])).toBe(
    "repo mutate: reports mixes cargo-mutants runs of 4 and 8 shards; use one run's reports\n",
  );
  expect(await run([shard(1, two), rust(1), rust(2), rust(3), rust(4)])).toBe(
    "repo mutate: reports is missing stryker shard 2 of 2; download every shard's report first\n",
  );
});

it("refuses reports of two tools whose heads differ", async () => {
  const f = fakes(undefined, ["crates/a"]);
  const reports = [shard(1, { tool: "stryker", total: 1 }), { ...rust(1), head: OTHER }];
  reports.forEach((report, i) => f.files.set(at("reports", `mutation-${i + 1}.json`), JSON.stringify(report)));
  await runMutate(["check", "reports"], f.deps);
  expect(f.err.join("")).toBe("repo mutate: reports holds shards of 09ed564 and 1a2b3c4; use one run's reports\n");
});

it("sums the score of a file that two cargo-mutants shards both hold, as the unsharded run scores it", async () => {
  const f = fakes(undefined, ["crates/a"]);
  const file = "crates/a/src/lib.rs";
  const reports = [
    { ...rust(1, { [file]: { killed: 4, survivors: [] } }), shard: { index: 1, total: 2 } },
    { ...rust(2, { [file]: { killed: 4, survivors: [survivor] } }), shard: { index: 2, total: 2 } },
  ];
  reports.forEach((report, i) => f.files.set(at("reports", `mutation-${i + 1}.json`), JSON.stringify(report)));
  expect(await runMutate(["check", "reports"], f.deps)).toBe(0);
  expect(f.out).toEqual(["mutate: 2 shards of 09ed564; crates/a 88.89% (no floor)\n"]);
});
