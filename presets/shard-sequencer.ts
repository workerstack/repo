import fs from "node:fs";
import path from "node:path";

import { BaseSequencer, type TestSpecification } from "vitest/node";
import { z } from "zod";

import { isRecord, tryJson } from "../cli/json.ts";

/**
 * Vitest's sequencer for sharded runs: files split by their measured time from `.repo/test-times.json` for this
 * platform, so every shard takes about the same time. With no table, no row for the platform or no known file it
 * keeps vitest's hash split.
 */
export class ShardSequencer extends BaseSequencer {
  /** The share of files without a time, as one in this many, above which the table counts as stale. */
  private static readonly STALE_ONE_IN = 10;

  /**
   * Splits the files named by `keys` into `count` shards by their time in `times`: longest first onto the
   * least-loaded shard, ties by path then lowest shard index. A file with no time weighs the median of the known
   * files in this run. Every input gives the same split, so shards that read one table never disagree. Null when no
   * file is known.
   */
  static split(
    keys: string[],
    times: Record<string, number>,
    count: number,
  ): { shards: number[][]; unknown: number } | null {
    const files = keys.map((key, at) => ({ at, key, time: times[key] }));
    const known = files.flatMap(({ time }) => (time === undefined ? [] : [time]));

    if (known.length === 0) return null;
    const fallback = ShardSequencer.median(known);
    const weighed = files.map((file) => ({ ...file, weight: file.time ?? fallback }));
    const longest = ShardSequencer.ordered(weighed, (a, b) => ShardSequencer.compare(a, b));
    const bins = Array.from({ length: count }, () => ({ at: new Array<number>(), load: 0 }));

    for (const { at, weight } of longest) {
      let bin = { at: new Array<number>(), load: Number.POSITIVE_INFINITY };

      for (const next of bins) if (next.load < bin.load) bin = next;
      bin.at.push(at);
      bin.load += weight;
    }

    return { shards: bins.map((bin) => bin.at), unknown: files.length - known.length };
  }

  override shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;

    if (shard === undefined) return super.shard(files);
    const row = ShardSequencer.readRow(root);
    const keys = files.map((spec) => path.relative(root, spec.moduleId).split(path.sep).join("/"));
    const split = row === undefined ? null : ShardSequencer.split(keys, row, shard.count);

    if (split === null) return super.shard(files);

    // More than a tenth of the files without a time: the table is stale.
    if (split.unknown * ShardSequencer.STALE_ONE_IN > keys.length) {
      process.stderr.write(
        `repo shard: ${split.unknown} of ${keys.length} files have no time for ${process.platform}; ` +
          "run `bun repo ci times` on a CI run's reports\n",
      );
    }

    const mine = new Set(split.shards[shard.index - 1]);

    return Promise.resolve(files.filter((_, at) => mine.has(at)));
  }

  /** Longest first, then by path, then by position: a total order, so the same input splits the same way. */
  private static compare(a: { at: number; key: string; weight: number }, b: typeof a): number {
    if (a.weight !== b.weight) return b.weight - a.weight;

    if (a.key !== b.key) return a.key < b.key ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

    return a.at - b.at;
  }

  /** A copy of `values` ordered by `order`, equal items in input order (the presets' lib has no `toSorted`). */
  private static ordered<T>(values: readonly T[], order: (a: T, b: T) => number): T[] {
    const result = new Array<T>();

    for (const value of values) {
      const later = result.findIndex((placed) => order(placed, value) > 0);
      result.splice(later < 0 ? result.length : later, 0, value);
    }

    return result;
  }

  /** The median of `values` in whole ms; the middle two averaged and rounded down for an even count. */
  private static median(values: number[]): number {
    const sorted = ShardSequencer.ordered(values, (a, b) => a - b);
    const middle = sorted.slice((sorted.length - 1) >> 1, (sorted.length >> 1) + 1);

    return Math.floor(middle.reduce((sum, value) => sum + value, 0) / middle.length);
  }

  /** The platform's row of the table under `root`, or none when the table or the row is missing or unreadable. */
  private static readRow(root: string): Record<string, number> | undefined {
    try {
      const text = fs.readFileSync(path.join(root, ".repo", "test-times.json"), "utf8");
      const row = tryJson(z.record(z.string(), z.unknown()), text)?.[process.platform];

      if (!isRecord(row)) return undefined;

      return Object.fromEntries(
        Object.entries(row).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
      );
    } catch {
      return undefined;
    }
  }
}
