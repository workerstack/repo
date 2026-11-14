import type { Result } from "../result.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { NODE_RUNTIME } from "./node-runtime.constants.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

/**
 * The one range `read` finds across the root and the workspace packages, undefined when none declares one, or the
 * refusal naming `field` and each declaring package (the root as `.`) when they differ.
 */
function oneRange(
  workspace: Workspace,
  field: string,
  read: (manifest: PackageJson) => string | undefined,
): Result<string | undefined, string> {
  const declared = [{ dir: ".", manifest: workspace.manifest }, ...workspace.packages]
    .flatMap(({ dir, manifest }) => {
      const range = read(manifest);

      return range === undefined ? [] : [{ dir, range }];
    })
    .toSorted((a, b) => byCodeUnit(a.dir, b.dir));

  const ranges = new Set(declared.map(({ range }) => range));

  if (ranges.size <= 1) return { ok: true, value: declared[0]?.range };
  const named = declared.map(({ dir, range }) => `${dir} ${range}`).join(", ");

  return { error: `${field} differs across packages (${named}); set one range in each`, ok: false };
}

/** The one `engines.node` range the packages declare: the node the packages themselves run on. */
export function nodeRange(workspace: Workspace): Result<string | undefined, string> {
  return oneRange(workspace, "engines.node", (manifest) => manifest.engines?.node);
}

/** The one node range `devEngines.runtime` names across the packages: the node their node test runs need. */
export function devNodeRange(workspace: Workspace): Result<string | undefined, string> {
  return oneRange(
    workspace,
    "devEngines.runtime",
    (manifest) => [manifest.devEngines?.runtime ?? []].flat().find((runtime) => runtime.name === NODE_RUNTIME)?.version,
  );
}
