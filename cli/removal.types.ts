import type { Route } from "./update.types.ts";

/**
 * One entry `repo remove` takes out: a dependency, a catalog entry, or an override, resolution, trust or patch
 * entry.
 */
export type Removal = {
  name: string;
  /** Where the line says it: the package's dir, `package.json`, `the catalog` or `the <name> catalog`. */
  said: string;
  field: string;
  /** The root-relative POSIX path of the package.json that holds it. */
  file: string;
  /** The object or array that holds it and the key (or, in an array, the element). */
  route: Route;
  /** The patch file a `patchedDependencies` entry points to, root-relative POSIX; null for every other entry. */
  patch: string | null;
};
