import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { onTestFinished } from "vitest";

import { removeTemps } from "../../__fixtures__/remove-temps.ts";

/** A temp dir holding `entries` (a dir when it ends in `/`, else an empty file), removed after the test. */
export function fileTree(entries: readonly string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-"));
  onTestFinished(() => removeTemps([dir]));

  for (const entry of entries) {
    const at = path.join(dir, entry);
    fs.mkdirSync(entry.endsWith("/") ? at : path.dirname(at), { recursive: true });

    if (!entry.endsWith("/")) fs.writeFileSync(at, "");
  }

  return dir;
}
