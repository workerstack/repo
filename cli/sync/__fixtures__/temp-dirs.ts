// Temp dirs for the sync suites; a test file calls `useTempDirs` once and every dir made is removed after each test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const made: string[] = [];

/** A new empty temp dir named from `prefix`, removed after the test that made it. */
export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Registers the removal of every dir `tempDir` made in the calling test file. */
export function useTempDirs(): void {
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Writes `text` at `rel` under `root`, making its dirs. */
export function put(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
