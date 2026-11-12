/** Runs the type-surface scan over a kit built in a temp dir, for the type-surface suites. */
import { kitFiles, type Kit } from "./deps-kit.ts";
import { useTempTree } from "./temp-tree.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { typeSurface, type Surface } from "../type-surface.ts";

/** What a scan saw, with `uses` and `keys` as plain objects, and the dir it ran in. */
export type Seen = { dir: string; uses: Record<string, string[]>; keys: Record<string, string>; missing: Surface["missing"] };

/** Per test file: a scan of a kit, after `prepare` changes its dir; the dirs are removed after each test. */
export function useSurfaceOf(prefix: string): (kit: Kit, prepare?: (dir: string) => void) => Seen {
  const tree = useTempTree(prefix);

  return (kit, prepare) => {
    const dir = tree(kitFiles(kit));
    prepare?.(dir);
    const read = readWorkspace(dir);
    const { uses, keys, missing } = typeSurface(dir, read.ok ? read.workspace.manifest : {});

    return { dir, keys: Object.fromEntries(keys), missing, uses: Object.fromEntries(uses) };
  };
}
