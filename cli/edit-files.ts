import fs from "node:fs";
import path from "node:path";

import { JSON_INDENT, POSIX } from "./update.constants.ts";

/** One change to a parsed manifest: the root-relative POSIX file and what to do to its parsed JSON, in place. */
export type Edit = { file: string; apply: (raw: unknown) => void };

/**
 * Reads each file the edits name once, applies its edits in place so key order stays, and writes it back as JSON.
 * Returns the root-relative files it wrote, in the order they first changed, with the platform's separators.
 */
export function editFiles(root: string, edits: readonly Edit[]): string[] {
  const byFile = Map.groupBy(edits, (edit) => edit.file);

  return [...byFile].map(([file, list]) => {
    const parts = file.split(POSIX);
    const full = path.join(root, ...parts);
    const raw: unknown = JSON.parse(fs.readFileSync(full, "utf8"));

    for (const edit of list) edit.apply(raw);
    fs.writeFileSync(full, `${JSON.stringify(raw, null, JSON_INDENT)}\n`);

    return path.join(...parts);
  });
}
