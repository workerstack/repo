import fs from "node:fs";
import path from "node:path";

import { tryJson } from "../json.ts";
import { packageJsonSchema } from "../package-json.ts";
import { PACKAGE_NAME } from "./package-name.constants.ts";

/** Whether a package.json `name` is this package's own. */
export function isSelfName(name: string | undefined): boolean {
  return name === PACKAGE_NAME;
}

/** The installed stock package under `root`; in this repo it is the self link back to the root. */
export function stockRoot(root: string): string {
  return path.join(root, "node_modules", "@workerstack", "repo");
}

/** Whether the package at `root` is `@workerstack/repo` itself, by its package.json name. */
export function isSelf(root: string): boolean {
  try {
    const text = fs.readFileSync(path.join(root, "package.json"), "utf8");

    return isSelfName(tryJson(packageJsonSchema.pick({ name: true }), text)?.name);
  } catch {
    return false;
  }
}
