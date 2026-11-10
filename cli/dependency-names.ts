import type { PackageJson } from "./sync/workspace.ts";

export const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/** The names a package.json declares as dependencies, in any of the four fields, once each. */
export function dependencyNames(manifest: PackageJson): string[] {
  return [...new Set(FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})))];
}
