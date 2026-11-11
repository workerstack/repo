/**
 * `repo ci merge <dir>`: merges the `blob-<i>-<n>.json` files of the coverage shards in `<dir>` into one vitest run
 * that prints the summary and the coverage table and checks every floor, which a shard leaves unchecked.
 */
import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE, findRoot } from "../config.ts";
import { plural, textOf } from "./ci-gate.ts";
import type { SkipsIo } from "./ci-skips.ts";
import {
  BLOB_ANY_FILE,
  BLOB_FILE,
  MERGE_REPORTS_FLAG,
  VITEST_COVERAGE_FLAG,
  VITEST_RUN_COMMAND,
} from "./ci.constants.ts";
import { countsOfRun, type Bins } from "./turn-steps.ts";

/** Where `repo ci merge` runs and prints, and the vitest it runs. */
export type MergeIo = SkipsIo & { bins: Bins };

/** The `blob-*.json` file names directly in `dir`, sorted; none when it is not a directory. */
function blobNames(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && BLOB_ANY_FILE.test(entry.name))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
}

/** True when `names` are exactly `blob-1-n.json` to `blob-n-n.json` of one `n`. */
function isWholeSet(names: string[]): boolean {
  const found = names.map((name) => BLOB_FILE.exec(name));
  const counts = new Set(found.map((match) => match?.groups?.["count"]));
  const indexes = found.map((match) => Number(match?.groups?.["index"])).toSorted((a, b) => a - b);
  return counts.size === 1 && counts.has(String(names.length)) && indexes.every((index, at) => index === at + 1);
}

/** vitest's args: a merged run of the blobs in `dir` that checks the floors. */
function mergeArgs(dir: string): string[] {
  return [VITEST_RUN_COMMAND, `${MERGE_REPORTS_FLAG}${dir}`, VITEST_COVERAGE_FLAG];
}

/** `repo ci merge <dir>`: 0 when vitest merges the blobs and every floor is met; 1, with the reason, otherwise. */
export function mergeMain(dir: string, io: MergeIo): number {
  function fail(line: string): number {
    io.stderr(`repo ci merge: ${line}\n`);
    return 1;
  }
  const root = findRoot(io.cwd);
  if (root === null) return fail(`no ${CONFIG_FILE} in ${io.cwd} or any parent; run \`bun repo init\``);
  const at = path.resolve(io.cwd, dir);
  const names = blobNames(at);
  if (names.length === 0) return fail(`no blob-*.json in ${dir}`);
  if (!isWholeSet(names)) return fail(`${dir} holds ${names.join(", ")}; want blob-1-n … blob-n-n of one n`);
  const run = io.bins.vitest(mergeArgs(at), root);
  if (run === null) return fail(`no blob-*.json in ${dir}`);
  io.stdout(textOf(run));
  const blobs = plural(names.length, "blob");
  if (run.code !== 0) {
    io.stdout(`repo ci merge: ${blobs}, floors or tests failed (vitest's ERROR lines above)\n`);
    return 1;
  }
  io.stdout(`repo ci merge: ${blobs}, ${plural(countsOfRun(run).passed, "test")}, every floor met\n`);
  return 0;
}
