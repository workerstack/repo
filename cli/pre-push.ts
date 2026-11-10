import { dependencyNames } from "./dependency-names.ts";
import { LinkError } from "./link-error.ts";
import { markersIn } from "./link-installed.ts";
import type { LinkContext } from "./link-io.types.ts";
import { readState } from "./link-state.ts";
import { EXIT_FAIL, refusedPush } from "./link.constants.ts";
import { readWorkspace } from "./sync/workspace.ts";

/**
 * The push check: refuses (exit 1, one line per pair) while a public package of this checkout, its root or a workspace
 * package with `private` not true, depends on a package linked in the install root. Silent when nothing is linked.
 */
export function prePush(ctx: LinkContext): number {
  const root = ctx.roots.install;
  const linked = new Set([...Object.keys(readState(root)), ...markersIn(root).map((marker) => marker.name)]);
  if (linked.size === 0) return 0;
  const read = readWorkspace(ctx.roots.checkout);
  if (!read.ok) throw new LinkError(read.errors.join("\n"));
  const { manifest, packages } = read.workspace;
  let code = 0;
  for (const pkg of [manifest, ...packages.map((entry) => entry.manifest)]) {
    if (pkg.name === undefined || pkg.private === true) continue;
    for (const dep of dependencyNames(pkg).filter((name) => linked.has(name))) {
      ctx.io.err(`repo ${ctx.command}: ${refusedPush(pkg.name, dep)}`);
      code = EXIT_FAIL;
    }
  }
  return code;
}
