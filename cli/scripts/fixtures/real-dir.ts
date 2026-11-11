/** Real-path temp dirs for script tests; each test file calls `useTempDirs` once. */
import fs from "node:fs";
import path from "node:path";

import { tempDir } from "../../sync/fixtures/temp-dirs.ts";

/** A new dir (real path) inside a temp dir, so the `${dir}-alias` link `aliasOf` makes is removed with it. */
export function realDir(prefix: string): string {
  const dir = path.join(fs.realpathSync(tempDir(prefix)), "r");
  fs.mkdirSync(dir);
  return dir;
}
