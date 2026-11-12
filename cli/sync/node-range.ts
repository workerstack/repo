import type { Result } from "../result.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import type { Workspace } from "./workspace.ts";

/**
 * The one `engines.node` range the root and the workspace packages declare, undefined when none declares one, or the
 * refusal naming each declaring package (the root as `.`) when they differ.
 */
export function nodeRange(workspace: Workspace): Result<string | undefined, string> {
  const declared = [{ dir: ".", manifest: workspace.manifest }, ...workspace.packages]
    .flatMap(({ dir, manifest }) => {
      const range = manifest.engines?.node;

      return range === undefined ? [] : [{ dir, range }];
    })
    .toSorted((a, b) => byCodeUnit(a.dir, b.dir));

  const ranges = new Set(declared.map(({ range }) => range));

  if (ranges.size <= 1) return { ok: true, value: declared[0]?.range };
  const named = declared.map(({ dir, range }) => `${dir} ${range}`).join(", ");

  return { error: `engines.node differs across packages (${named}); set one range in each`, ok: false };
}
