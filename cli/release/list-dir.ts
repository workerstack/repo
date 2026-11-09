import fs from "node:fs";

/** The names in a directory. */
export function listDir(dir: string): string[] {
  return fs.readdirSync(dir);
}
