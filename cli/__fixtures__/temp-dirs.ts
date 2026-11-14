/** Temp directories a test file makes, removed after each test along with the mocks it set. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import { removeTemps } from "./remove-temps.ts";

/** Registers the cleanup; `tempDir` makes a directory with `prefix`, `track` adds a path to remove. */
export function useTempDirs(prefix: string): { track: (file: string) => void; tempDir: () => string } {
  const temps: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    removeTemps(temps.splice(0));
  });
  return {
    tempDir: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      temps.push(dir);
      return dir;
    },
    track: (file) => temps.push(file),
  };
}
