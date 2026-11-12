import { expect, it } from "vitest";

import { parseArgs } from "./mutate-args.ts";
import { selectFiles, splitShards } from "./mutate-files.ts";

it("keeps the tracked files matching a glob, minus tests, fixtures and declaration files, sorted", () => {
  const tracked = [
    "src/z.ts",
    "src/a.ts",
    "src/a.test.ts",
    "src/a.spec.tsx",
    "src/__fixtures__/c.ts",
    "src/deep/__fixtures__/d.ts",
    "src/types.d.ts",
    "lib/x.ts",
    "docs/y.ts",
  ];

  expect(selectFiles(tracked, ["src/**/*.ts", "lib/*.ts"])).toStrictEqual(["lib/x.ts", "src/a.ts", "src/z.ts"]);
});

it("returns nothing when no glob matches", () => {
  expect(selectFiles(["a.ts"], ["src/**/*.ts"])).toStrictEqual([]);
});

const lines = new Map([
  ["a.ts", 50],
  ["b.ts", 30],
  ["c.ts", 30],
  ["d.ts", 20],
  ["e.ts", 10],
]);

it("balances the shards by line count and keeps each shard sorted", () => {
  const shards = [1, 2].map((index) => splitShards([...lines.keys()], lines, { index, total: 2 }));
  expect(shards).toStrictEqual([
    ["a.ts", "d.ts"],
    ["b.ts", "c.ts", "e.ts"],
  ]);
});

it("gives every file to exactly one shard, whatever the order it arrives in", () => {
  const names = [...lines.keys()].toReversed();
  const all = [1, 2, 3].flatMap((index) => splitShards(names, lines, { index, total: 3 }));
  expect(all.toSorted()).toStrictEqual([...lines.keys()]);
  expect(splitShards(names, lines, { index: 1, total: 3 })).toStrictEqual(
    splitShards([...lines.keys()], lines, { index: 1, total: 3 }),
  );
});

it("hands one shard everything when there is one, and nothing to a shard past the files", () => {
  expect(splitShards([...lines.keys()], lines, { index: 1, total: 1 })).toHaveLength(5);
  expect(splitShards(["a.ts"], lines, { index: 2, total: 2 })).toStrictEqual([]);
});

it("defaults to one full run with the default report", () => {
  expect(parseArgs([])).toStrictEqual({
    kind: "run",
    report: undefined,
    shard: { index: 1, total: 1 },
    tool: "stryker",
  });
});

it("reads --shard and --report, as two words or with =", () => {
  expect(parseArgs(["--shard", "2/8", "--report", "r/m.json"])).toStrictEqual({
    kind: "run",
    report: "r/m.json",
    shard: { index: 2, total: 8 },
    tool: "stryker",
  });
  expect(parseArgs(["--shard=3/4", "--report=x.json"])).toMatchObject({ shard: { index: 3, total: 4 } });
});

it.each(["0/8", "9/8", "a/b", "2", "2/0", "1/2/3", ""])("refuses --shard %j", (value) => {
  expect(parseArgs(["--shard", value])).toStrictEqual({
    kind: "error",
    line: "--shard takes i/n with 1 <= i <= n, such as 2/8",
  });
});

it("reads --rust anywhere among the flags as the cargo-mutants tool", () => {
  expect(parseArgs(["--rust"])).toStrictEqual({
    kind: "run",
    report: undefined,
    shard: { index: 1, total: 1 },
    tool: "cargo-mutants",
  });
  expect(parseArgs(["--shard", "2/4", "--rust", "--report", "r.json"])).toMatchObject({
    report: "r.json",
    shard: { index: 2, total: 4 },
    tool: "cargo-mutants",
  });
  expect(parseArgs(["--rust=x"])).toStrictEqual({
    kind: "error",
    line: 'unknown argument "x"; use --shard i/n, --report <file>, --rust or check <dir>',
  });
});

it("refuses --shard and --report without a value", () => {
  expect(parseArgs(["--shard"])).toMatchObject({ kind: "error" });
  expect(parseArgs(["--report"])).toStrictEqual({ kind: "error", line: "--report takes a file path" });
});

it("reads check <dir> with and without --write", () => {
  expect(parseArgs(["check", "reports"])).toStrictEqual({ dir: "reports", kind: "check", write: false });
  expect(parseArgs(["check", "reports", "--write"])).toStrictEqual({ dir: "reports", kind: "check", write: true });
  expect(parseArgs(["check", "--write", "reports"])).toStrictEqual({ dir: "reports", kind: "check", write: true });
});

it("refuses check without a dir and anything it does not know", () => {
  expect(parseArgs(["check"])).toStrictEqual({ kind: "error", line: "check takes the dir of the shard reports" });
  expect(parseArgs(["--fast"])).toStrictEqual({
    kind: "error",
    line: 'unknown argument "--fast"; use --shard i/n, --report <file>, --rust or check <dir>',
  });
});

it("weighs a file with no line count as nothing", () => {
  const known = new Map([["a.ts", 5]]);
  expect(splitShards(["a.ts", "ghost.ts"], known, { index: 2, total: 2 })).toStrictEqual(["ghost.ts"]);
});
