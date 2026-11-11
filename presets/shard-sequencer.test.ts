import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { TestSpecification } from "vitest/node";

import { useTempDirs } from "../cli/__fixtures__/temp-dirs.ts";
import { ShardSequencer } from "./shard-sequencer.ts";

const { tempDir } = useTempDirs("workerstack-shard-");

/** `count` paths `d<n>/f<n>.test.ts`, zero padded so the path order is the number order. */
function paths(count: number): string[] {
  return Array.from({ length: count }, (_, n) => `d${n % 7}/f${String(n).padStart(4, "0")}.test.ts`);
}

/** A time per path, from `weigh`. */
function table(keys: string[], weigh: (n: number) => number): Record<string, number> {
  return Object.fromEntries(keys.map((key, n) => [key, weigh(n)]));
}

/** The load of each shard of indices. */
function loads(shards: number[][], times: Record<string, number>, keys: string[]): number[] {
  return shards.map((shard) => shard.reduce((sum, at) => sum + (times[keys[at] ?? ""] ?? 0), 0));
}

describe("ShardSequencer.split", () => {
  it.each([1, 2, 3, 4, 5])("puts every file in exactly one of %d shards", (count) => {
    const keys = paths(600);
    const times = table(keys, (n) => 100 + ((n * 37) % 900));
    const split = ShardSequencer.split(keys, times, count);
    expect(split?.shards).toHaveLength(count);
    expect(split?.shards.flat().toSorted((a, b) => a - b)).toStrictEqual(keys.map((_, n) => n));
    expect(split?.unknown).toBe(0);
  });

  it("places longest first onto the least loaded shard, ties by path then lowest shard", () => {
    const keys = ["b.ts", "a.ts", "c.ts", "d.ts", "e.ts"];
    const times = { "a.ts": 9, "b.ts": 9, "c.ts": 5, "d.ts": 4, "e.ts": 4 };
    // a(9) -> 0; b(9) -> 1; c(5) -> 0 (tie, lowest shard) = 14; d(4) -> 1 = 13; e(4) -> 1 = 17
    expect(ShardSequencer.split(keys, times, 2)?.shards).toStrictEqual([
      [1, 2],
      [0, 3, 4],
    ]);
  });

  it("gives one path listed twice to two shards in listed order", () => {
    expect(ShardSequencer.split(["a.ts", "a.ts"], { "a.ts": 3 }, 2)?.shards).toStrictEqual([[0], [1]]);
  });

  it("gives equal files to shards in path order", () => {
    const keys = ["z.ts", "y.ts", "x.ts"];
    const times = { "x.ts": 7, "y.ts": 7, "z.ts": 7 };
    expect(ShardSequencer.split(keys, times, 3)?.shards).toStrictEqual([[2], [1], [0]]);
  });
});

describe("ShardSequencer.split balance", () => {
  it.each([2, 3])("keeps max/min load at most 1.2 over %d shards when 20 of 600 files hold half the time", (count) => {
    const keys = paths(600);
    const times = table(keys, (n) => (n % 30 === 0 ? 29_000 : 500));
    const split = ShardSequencer.split(keys, times, count);
    const sums = loads(split?.shards ?? [], times, keys);
    expect(Math.max(...sums) / Math.min(...sums)).toBeLessThanOrEqual(1.2);
  });
});

describe("ShardSequencer.split unknown files", () => {
  it("is the same split for the same input", () => {
    const keys = paths(200);
    const times = table(keys, (n) => 1 + ((n * 91) % 400));
    expect(ShardSequencer.split(keys, times, 3)).toStrictEqual(ShardSequencer.split([...keys], { ...times }, 3));
  });

  it("weighs a file with no time at the median of the known files and counts it", () => {
    const keys = ["a.ts", "b.ts", "c.ts", "d.ts", "new.ts"];
    const times = { "a.ts": 10, "b.ts": 30, "c.ts": 20 };
    const split = ShardSequencer.split(keys, times, 2);
    expect(split?.unknown).toBe(2);
    // known: 10 20 30 -> median 20; d and new weigh 20 each; b, then c, d, new, then a
    expect(split?.shards).toStrictEqual([
      [1, 4],
      [2, 3, 0],
    ]);
  });

  it("weighs unknown files at the mean of the two middle times for an even count of known files", () => {
    const keys = ["a.ts", "b.ts", "x.ts"];
    const times = { "a.ts": 10, "b.ts": 21 };
    // median 15 (whole ms): b -> 0, x(15) -> 1, a(10) -> 1
    expect(ShardSequencer.split(keys, times, 2)?.shards).toStrictEqual([[1], [2, 0]]);
  });

  it("is null when no file is known", () => {
    expect(ShardSequencer.split(["a.ts", "b.ts"], { "other.ts": 5 }, 2)).toBeNull();
    expect(ShardSequencer.split([], {}, 2)).toBeNull();
  });
});

/** A fake vitest ctx for a run rooted at `root`, shard `index`/`count`. */
function ctxOf(root: string, index: number, count: number) {
  return { config: { root, shard: { count, index } } };
}

/** `file` with forward slashes, as vite writes module ids on every platform. */
function posix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Specs for the root-relative `names`. */
function specsOf(root: string, names: string[]): TestSpecification[] {
  // The sequencer reads only a spec's moduleId.
  return names.map((name) => ({ moduleId: `${posix(root)}/${name}` }) /* only moduleId is read */ as TestSpecification);
}

/** A temp root holding `.repo/test-times.json` with `body` when it is given. */
function rootWith(body?: string): string {
  const root = tempDir();
  if (body !== undefined) {
    fs.mkdirSync(path.join(root, ".repo"));
    fs.writeFileSync(path.join(root, ".repo", "test-times.json"), body);
  }
  return root;
}

function sequencer(root: string, index: number, count: number): ShardSequencer {
  return new ShardSequencer(ctxOf(root, index, count) /* a fake of the ctx fields read */ as never);
}

const NAMES = ["a/one.test.ts", "a/two.test.ts", "b/three.test.ts", "b/four.test.ts"];
const ROW = { "a/one.test.ts": 100, "a/two.test.ts": 10, "b/four.test.ts": 40, "b/three.test.ts": 60 };

/** The root-relative names of `specs`. */
function relative(root: string, specs: TestSpecification[]): string[] {
  return specs.map((spec) => posix(path.relative(root, spec.moduleId)));
}

/** The module ids of `specs`, sorted. */
function ids(specs: TestSpecification[]): string[] {
  return specs.map((spec) => spec.moduleId).toSorted();
}

/** A stderr spy that swallows the output. */
function spyStderr() {
  return vi.spyOn(process.stderr, "write").mockReturnValue(true);
}

describe("ShardSequencer by time", () => {
  it("splits by the table's row for the platform, silently when every file is known", async () => {
    const write = spyStderr();
    const root = rootWith(JSON.stringify({ [process.platform]: ROW, other: { "a/one.test.ts": 1 } }));
    const specs = specsOf(root, NAMES);
    // 100 -> 1; 60 -> 2; 40 -> 2 (60 vs 100); 10 -> 1 (100 vs 100, lowest shard)
    expect(relative(root, await sequencer(root, 1, 2).shard(specs))).toStrictEqual(["a/one.test.ts", "a/two.test.ts"]);
    const second = await sequencer(root, 2, 2).shard(specs);
    expect(relative(root, second)).toStrictEqual(["b/three.test.ts", "b/four.test.ts"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("prints the refresh line when more than 10% of the files have no time", async () => {
    const write = spyStderr();
    const root = rootWith(JSON.stringify({ [process.platform]: { "a/one.test.ts": 5 } }));
    await sequencer(root, 1, 2).shard(specsOf(root, NAMES));
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `repo shard: 3 of 4 files have no time for ${process.platform}; ` +
        "run `bun repo ci times` on a CI run's reports\n",
    );
  });

  it("prints nothing at exactly 10% unknown", async () => {
    const write = spyStderr();
    const keys = paths(10);
    const root = rootWith(JSON.stringify({ [process.platform]: table(keys.slice(1), () => 5) }));
    expect(await sequencer(root, 1, 1).shard(specsOf(root, keys))).toHaveLength(10);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("ShardSequencer hash fallback", () => {
  const nowhere = JSON.stringify({ nowhere: { "a/one.test.ts": 1 } });
  const slow = JSON.stringify({ [process.platform]: { "y.ts": "slow", "z.ts": 1 } });

  it.each([
    ["has no table", undefined],
    ["has a table that is not JSON", "{"],
    ["has a table that is no object", "5"],
    ["has a table that is null", "null"],
    ["has a table that is an array", "[]"],
    ["has a table with no row for the platform", nowhere],
    ["has a row that is no object", JSON.stringify({ [process.platform]: 5 })],
    ["has a row with no time for any file run", slow],
  ])("keeps vitest's split, whole and silent, when the root %s", async (_name, body) => {
    const write = spyStderr();
    const root = rootWith(body);
    const specs = specsOf(root, NAMES);
    const shards = await Promise.all([1, 2].map((index) => sequencer(root, index, 2).shard(specs)));
    expect(ids(shards.flat())).toStrictEqual(ids(specs));
    expect(shards[0]).toHaveLength(2);
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves a run with no shard to vitest, which rejects it", async () => {
    const root = rootWith(JSON.stringify({ [process.platform]: ROW }));
    const specs = specsOf(root, NAMES);
    const bare = new ShardSequencer({ config: { root } } /* a fake of the ctx fields read */ as never);
    await expect(bare.shard(specs)).rejects.toThrow(TypeError);
  });
});
