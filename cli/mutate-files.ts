/** Which files `repo mutate` mutates, and how a run splits them into shards. */
import path from "node:path";
import { EXCLUDED } from "./mutate.constants.ts";
import type { Shard } from "./mutate-args.ts";

/** The tracked files matching one of `globs`, minus tests, fixtures and declaration files, sorted. */
export function selectFiles(tracked: readonly string[], globs: readonly string[]): string[] {
  return tracked
    .filter((file) => globs.some((glob) => path.matchesGlob(file, glob)))
    .filter((file) => !EXCLUDED.some((pattern) => pattern.test(file)))
    .toSorted();
}

/** A shard being filled: its place, the lines handed to it so far and its files. */
type Bin = { index: number; load: number; taken: string[] };

/**
 * The files of one shard: the sorted files, heaviest first, each handed to the lightest shard so far (the lowest
 * index on a tie), so the same list always splits the same way and the shards stay near equal in lines.
 */
export function splitShards(files: readonly string[], lines: ReadonlyMap<string, number>, shard: Shard): string[] {
  const size = (file: string) => lines.get(file) ?? 0;
  const heaviest = files.toSorted((a, b) => size(b) - size(a) || a.localeCompare(b));
  const shards = Array.from({ length: shard.total }, (_, at): Bin => ({ index: at + 1, load: 0, taken: [] }));
  for (const file of heaviest) {
    const lightest = shards.reduce((best, next) => (next.load < best.load ? next : best));
    lightest.load += size(file);
    lightest.taken.push(file);
  }
  return shards.flatMap((one) => (one.index === shard.index ? one.taken.toSorted() : []));
}
