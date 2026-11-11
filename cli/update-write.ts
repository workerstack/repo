import { editFiles } from "./edit-files.ts";
import type { Checked, Route } from "./update.types.ts";

/** The value under `key` of a node on a route this run read. */
function child(node: unknown, key: string): unknown {
  return (node /* a JSON object on a route this run read */ as Record<string, unknown>)[key];
}

/** Sets the value at a path of a parsed JSON value, in place. */
function setAt(value: unknown, route: Route, to: string): void {
  let parent = value;
  for (const key of route.parent) parent = child(parent, key);
  (parent /* the object that holds the entry */ as Record<string, string>)[route.key] = to;
}

/** Writes each change's new spec into its manifests, once per file; returns the files written. */
export function updateWrite(root: string, changes: Checked[]): string[] {
  const edits = changes.flatMap((change) =>
    change.paths.map((route) => ({
      apply: (raw: unknown) => setAt(raw, route, `${change.prefix}${change.latest}`),
      file: change.file,
    })),
  );
  return editFiles(root, edits);
}
