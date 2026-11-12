import { branchAt } from "./at-route.ts";
import { editFiles } from "./edit-files.ts";
import type { Json } from "./json.ts";
import type { Checked, Route } from "./update.types.ts";

/** Sets the value at a path of a parsed JSON value, in place. */
function setAt(value: Json, route: Route, to: string): void {
  branchAt(value, route.parent)[route.key] = to;
}

/** Writes each change's new spec into its manifests, once per file; returns the files written. */
export function updateWrite(root: string, changes: Checked[]): string[] {
  const edits = changes.flatMap((change) =>
    change.paths.map((route) => ({
      apply: (raw: Json) => setAt(raw, route, `${change.prefix}${change.latest}`),
      file: change.file,
    })),
  );

  return editFiles(root, edits);
}
