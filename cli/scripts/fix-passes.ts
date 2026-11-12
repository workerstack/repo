/**
 * Fix passes to a fixpoint: oxlint's `--fix` applies one pass, so a fix that leaves another fixable hit (no-else-return
 * dropping an `else`, after which a blank line is wanted) stays for the next run. `repo lint --fix` and `repo turn`
 * rerun the pass here until one rewrites nothing, as eslint does.
 */
import fs from "node:fs";
import path from "node:path";

import { MAX_FIX_PASSES } from "./max-fix-passes.constants.ts";

/** The text of each of `files` under `root`, a gone one as null. */
function texts(root: string, files: readonly string[]): (string | null)[] {
  return files.map((rel) => {
    const file = path.join(root, rel);

    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  });
}

/** A `--fix` run over `files`, relative to `root`. */
type Fix<T> = { root: string; files: readonly string[]; pass: () => T };

/** The pass rerun while it rewrites one of the files, at most `left` more times; the last pass's result. */
function rerun<T>(fix: Fix<T>, left: number): T {
  const before = texts(fix.root, fix.files);
  const result = fix.pass();
  const after = texts(fix.root, fix.files);

  if (left <= 1 || after.every((content, at) => content === before[at])) return result;

  return rerun(fix, left - 1);
}

/**
 * `pass`, a `--fix` run over `files` (relative to `root`), rerun until it rewrites none of them, at most
 * MAX_FIX_PASSES times; the result of the last pass, whose report is the tree as left.
 */
export function fixPasses<T>(root: string, files: readonly string[], pass: () => T): T {
  return rerun({ files, pass, root }, MAX_FIX_PASSES);
}
