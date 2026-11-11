/** What the handover tests share: a temp root with files in it, the read back, and one pathless rule. */
import fs from "node:fs";
import path from "node:path";

import { put, tempDir } from "./temp-dirs.ts";

/** A handover input with no workspace packages and no stock history. */
export const NONE = { history: {}, packages: [] };
/** A pathless rule, whose body the handover moves into `AGENTS.md`. */
export const PATHLESS = "---\ndescription: Team\n---\nAlways run the linter.\n";

/** A temp root holding `files`. */
export function rootWith(files: Record<string, string>): string {
  const root = tempDir("workerstack-handover-");
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}

/** The text of the file at the root-relative `rel`. */
export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
