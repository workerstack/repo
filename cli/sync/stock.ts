import fs from "node:fs";
import path from "node:path";

export const PACKAGE_NAME = "@workerstack/repo";

/** Whether a package.json `name` is this package's own. */
export function isSelfName(name: unknown): boolean {
  return name === PACKAGE_NAME;
}

/** The installed stock package under `root`; in this repo it is the self link back to the root. */
export function stockRoot(root: string): string {
  return path.join(root, "node_modules", "@workerstack", "repo");
}

/** Whether the package at `root` is `@workerstack/repo` itself, by its package.json name. */
export function isSelf(root: string): boolean {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg === "object" && pkg !== null && isSelfName((pkg as { name?: unknown }).name);
  } catch {
    return false;
  }
}
