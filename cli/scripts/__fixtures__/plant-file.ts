import fs from "node:fs";
import path from "node:path";

/** Writes `text` at `rel` under `root`, making the parent dirs; returns the file's path. */
export function plantFile(root: string, rel: string, text: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
