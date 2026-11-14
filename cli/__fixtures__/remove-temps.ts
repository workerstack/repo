import fs from "node:fs";
import path from "node:path";

import { removeTree } from "../remove-tree.ts";

/** The entries under `dir` (two levels deep) with each mode and flags, for the message of a dir that would not go. */
export function describeLeftOver(dir: string): string {
  const row = (p: string) => {
    try {
      const st = fs.lstatSync(p);
      const flags = (st as { flags?: number }).flags;
      return `${path.relative(dir, p) || "."} mode=${st.mode.toString(8)}${flags === undefined ? "" : ` flags=${flags}`}`;
    } catch (error) {
      return `${p} (${(error as Error).message})`;
    }
  };
  try {
    const rows = [row(dir)];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      rows.push(row(p));
      if (e.isDirectory()) for (const n of fs.readdirSync(p)) rows.push(row(path.join(p, n)));
    }
    return rows.slice(0, 40).join("; ");
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Removes each of a test's temp `dirs` with `removeTree`'s retries. A dir that will not go does not stop the rest:
 * every dir is tried, then one Error names each dir left, its rm error and what is still in it, so the test fails.
 */
export function removeTemps(dirs: readonly string[]): void {
  const failed: string[] = [];

  for (const dir of dirs) {
    try {
      removeTree(dir);
    } catch (error) {
      failed.push(`${dir}: ${(error as Error).message}; left: ${describeLeftOver(dir)}`);
    }
  }

  if (failed.length === 0) return;
  const noun = failed.length === 1 ? "temp dir" : "temp dirs";
  throw new Error([`could not remove ${failed.length} ${noun}:`, ...failed].join("\n"));
}
