/** Temp skill roots for the tests of the skill conflict finder. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

const temps: string[] = [];

/** Removes every dir made since the last call; each test file runs it after each test. */
export function cleanSkillDirs(): void {
  removeTemps(temps.splice(0));
}

/** A fresh temp dir named from `prefix`. */
export function skillDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
