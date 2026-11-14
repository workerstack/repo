#!/usr/bin/env bun
/**
 * Writes `cli/sync/stock-history.json` from `main`, `HEAD` and the working tree. The commit gate (`repo turn`) writes
 * it on every commit that changes a stock file, so run this by hand only after a rebase conflict in the table, then
 * stage it.
 */
import path from "node:path";

import { DEFAULT_REFS, STOCK_HISTORY_REL } from "../cli/scripts/stock-history-collect.constants.ts";
import { writeStockHistory } from "../cli/scripts/stock-history-collect.ts";
import { processIo } from "./process-io.ts";

export type Io = { out: (line: string) => void; err: (line: string) => void };

/** Writes the table of the checkout at `root` (this one by default) and prints its path count, or the failure. */
export function run(io: Io, root: string = path.resolve(import.meta.dirname, "..")): number {
  const written = writeStockHistory(root, DEFAULT_REFS, "tree");

  if (!written.ok) {
    for (const line of written.error) io.err(line.trimEnd());

    return 1;
  }

  io.out(`wrote ${STOCK_HISTORY_REL}: ${written.value.paths} paths`);

  return 0;
}

if (import.meta.main) process.exitCode = run(processIo);
