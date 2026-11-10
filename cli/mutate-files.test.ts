import { expect, it } from "vitest";
import { parseArgs } from "./mutate-args.ts";
import { selectFiles, splitShards } from "./mutate-files.ts";

it("keeps the tracked files matching a glob, minus tests, fixtures and declaration files, sorted", () => {
  const tracked = [
    "src/z.ts",
    "src/a.ts",
    "src/a.test.ts",
    "src/a.spec.tsx",
    "src/fixtures/c.ts",
    "src/deep/fixtures/d.ts",
    "src/types.d.ts",
    "lib/x.ts",
    "docs/y.ts",
  ];
  expect(selectFiles(tracked, ["src/**/*.ts", "lib/*.ts"])).toEqual(["lib/x.ts", "src/a.ts", "src/z.ts"]);
});

it("returns nothing when no glob matches", () => {
  expect(selectFiles(["a.ts"], ["src/**/*.ts"])).toEqual([]);
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
  expect(shards).toEqual([
    ["a.ts", "d.ts"],
    ["b.ts", "c.ts", "e.ts"],
  ]);
});

it("gives every file to exactly one shard, whatever the order it arrives in", () => {
  const names = [...lines.keys()].reverse();
  const all = [1, 2, 3].flatMap((index) => splitShards(names, lines, { index, total: 3 }));
  expect(all.toSorted()).toEqual([...lines.keys()]);
  expect(splitShards(names, lines, { index: 1, total: 3 })).toEqual(
    splitShards([...lines.keys()], lines, { index: 1, total: 3 }),
  );
});

it("hands one shard everything when there is one, and nothing to a shard past the files", () => {
  expect(splitShards([...lines.keys()], lines, { index: 1, total: 1 })).toHaveLength(5);
  expect(splitShards(["a.ts"], lines, { index: 2, total: 2 })).toEqual([]);
});

it("defaults to one full run with the default report", () => {
  expect(parseArgs([])).toEqual({
    kind: "run",
    shard: { index: 1, total: 1 },
    report: undefined,
    tool: "stryker",
  });
});

it("reads --shard and --report, as two words or with =", () => {
  expect(parseArgs(["--shard", "2/8", "--report", "r/m.json"])).toEqual({
    kind: "run",
    shard: { index: 2, total: 8 },
    report: "r/m.json",
    tool: "stryker",
  });
  expect(parseArgs(["--shard=3/4", "--report=x.json"])).toMatchObject({ shard: { index: 3, total: 4 } });
});

it.each(["0/8", "9/8", "a/b", "2", "2/0", "1/2/3", ""])("refuses --shard %j", (value) => {
  expect(parseArgs(["--shard", value])).toEqual({
    kind: "error",
    line: "--shard takes i/n with 1 <= i <= n, such as 2/8",
  });
});

it("reads --rust anywhere among the flags as the cargo-mutants tool", () => {
  expect(parseArgs(["--rust"])).toEqual({
    kind: "run",
    shard: { index: 1, total: 1 },
    report: undefined,
    tool: "cargo-mutants",
  });
  expect(parseArgs(["--shard", "2/4", "--rust", "--report", "r.json"])).toMatchObject({
    shard: { index: 2, total: 4 },
    report: "r.json",
    tool: "cargo-mutants",
  });
  expect(parseArgs(["--rust=x"])).toEqual({
    kind: "error",
    line: 'unknown argument "x"; use --shard i/n, --report <file>, --rust or check <dir>',
  });
});

it("refuses --shard and --report without a value", () => {
  expect(parseArgs(["--shard"])).toMatchObject({ kind: "error" });
  expect(parseArgs(["--report"])).toEqual({ kind: "error", line: "--report takes a file path" });
});

it("reads check <dir> with and without --write", () => {
  expect(parseArgs(["check", "reports"])).toEqual({ kind: "check", dir: "reports", write: false });
  expect(parseArgs(["check", "reports", "--write"])).toEqual({ kind: "check", dir: "reports", write: true });
  expect(parseArgs(["check", "--write", "reports"])).toEqual({ kind: "check", dir: "reports", write: true });
});

it("refuses check without a dir and anything it does not know", () => {
  expect(parseArgs(["check"])).toEqual({ kind: "error", line: "check takes the dir of the shard reports" });
  expect(parseArgs(["--fast"])).toEqual({
    kind: "error",
    line: 'unknown argument "--fast"; use --shard i/n, --report <file>, --rust or check <dir>',
  });
});

it("weighs a file with no line count as nothing", () => {
  const known = new Map([["a.ts", 5]]);
  expect(splitShards(["a.ts", "ghost.ts"], known, { index: 2, total: 2 })).toEqual(["ghost.ts"]);
});
