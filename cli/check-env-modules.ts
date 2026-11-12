import path from "node:path";

import { ENV_FILE, MANIFEST } from "./env.constants.ts";
import { listFiles } from "./list-files.ts";

const ROOT = ".";

/** The folder of the nearest `package.json` at or above `rel`'s folder, `.` for the root or none. */
function packageOf(rel: string, manifests: ReadonlySet<string>): string {
  let dir = path.posix.dirname(rel);

  while (dir !== ROOT) {
    if (manifests.has(dir)) return dir;
    dir = path.posix.dirname(dir);
  }

  return ROOT;
}

/** `a, b and c`; a pair is `a and b`. */
function listOf(items: readonly string[]): string {
  const rest = [...items];
  const last = rest.pop();

  return `${rest.join(", ")} and ${last}`;
}

/**
 * One line per package with two or more `env.ts` files, sorted by package: the schema of a package's environment
 * lives in one module. Tracked and untracked non-ignored files count.
 */
export function checkEnvModules(cwd: string): string[] {
  const files = listFiles(cwd);

  const manifests = new Set(
    files.filter((rel) => path.posix.basename(rel) === MANIFEST).map((rel) => path.posix.dirname(rel)),
  );

  const byPackage = new Map<string, string[]>();

  for (const rel of files.filter((file) => path.posix.basename(file) === ENV_FILE)) {
    const pkg = packageOf(rel, manifests);
    byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), rel]);
  }

  return [...byPackage]
    .filter(([, found]) => found.length > 1)
    .toSorted(([a], [b]) => a.localeCompare(b, "en"))
    .map(([pkg, found]) => `env: ${listOf(found.toSorted())} are both ${ENV_FILE} in ${pkg}; keep one`);
}
