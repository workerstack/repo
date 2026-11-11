/** Planted git repos for the `.gitignore` guard tests; each test file calls `useTempDirs` once. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { put } from "../../sync/fixtures/temp-dirs.ts";
import { realDir } from "./real-dir.ts";

/** A git repo with root `.gitignore` `.tmp/` and `*.log`, and `packages/c/.gitignore` `dist-local/`. */
export function ignoreRepo(): string {
  const r = realDir("ignore-guard-");
  execFileSync("git", ["init", "-q"], { cwd: r });
  put(r, ".gitignore", ".tmp/\n*.log\n");
  put(r, "packages/c/.gitignore", "dist-local/\n");
  fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
  return r;
}
