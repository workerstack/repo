import fs from "node:fs";
import path from "node:path";

/** Names a PATH without node must lack. */
const NODE_BINS: readonly string[] = ["node", "nodejs", "npm", "npx"];

/**
 * A dir under `root` of links to every command on `searchPath` but node and its package managers, so a run that
 * reaches for node fails as it would on a machine with bun alone. The first PATH dir that has a name wins.
 */
export function nodelessPath(root: string, searchPath: string): string {
  const dir = path.join(root, "nodeless-bin");
  fs.mkdirSync(dir, { recursive: true });
  for (const from of searchPath.split(path.delimiter).filter(Boolean)) {
    if (!fs.existsSync(from)) continue;
    for (const name of fs.readdirSync(from)) {
      const link = path.join(dir, name);
      // lstat, not exists: a dangling link in `dir` reads as absent through exists and would be linked twice.
      if (!NODE_BINS.includes(name) && !fs.lstatSync(link, { throwIfNoEntry: false })) {
        fs.symlinkSync(path.join(from, name), link);
      }
    }
  }
  return dir;
}
