/** Temp skill roots for the tests of the skill conflict finder. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temps: string[] = [];

/** Removes every dir made since the last call; each test file runs it after each test. */
export function cleanSkillDirs(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
}

/** A fresh temp dir named from `prefix`. */
export function skillDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
