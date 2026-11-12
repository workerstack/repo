import { LAST } from "./commit-msg.constants.ts";
import type { Workspace } from "./sync/workspace.ts";

/** The last `/` segment of a package name, or the whole name when it has none. */
function lastSegment(name: string): string {
  return name.split("/").at(LAST) /* a split yields one part at least */ as string;
}

/** The scopes of a monorepo: the last segment of each workspace package name, or its folder; none for one package. */
export function scopesOf(workspace: Workspace): string[] | undefined {
  if (workspace.packages.length === 0) return undefined;
  const names = workspace.packages.map(({ dir, manifest }) => lastSegment(manifest.name ?? dir));

  return [...new Set(names)].toSorted();
}
