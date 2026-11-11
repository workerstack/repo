/** `repo remove <name>…` drops a dependency from every manifest, the catalogs and the root's overrides. */
import fs from "node:fs";

import { findRoot } from "./config.ts";
import { editFiles } from "./edit-files.ts";
import type { Removal } from "./removal.types.ts";
import { patchPath, removalsOf } from "./remove-scan.ts";
import { REMOVE_COMMAND, REMOVE_USAGE, namePart, placeNote, removedLine } from "./remove.constants.ts";
import { readWorkspace } from "./sync/workspace.ts";
import { fail, finish, said } from "./update-finish.ts";
import { updateIo } from "./update-io.ts";
import type { UpdateIo } from "./update-io.types.ts";
import { CATALOG, EXIT_USAGE, OPTION_PREFIX, nothingDepends } from "./update.constants.ts";

/** Takes the entry out of its object, or the element out of its array, in place. */
function drop(raw: unknown, { route }: Removal): void {
  let parent = raw;
  for (const key of route.parent)
    parent = (parent /* a JSON object on a route this run read */ as Record<string, unknown>)[key];
  if (Array.isArray(parent)) parent.splice(0, parent.length, ...parent.filter((item) => item !== route.key));
  else delete (parent /* the object that holds the entry */ as Record<string, unknown>)[route.key];
}

/** One `name from place (fields) and place` part of the line, places in the order they were found. */
function partOf(name: string, removals: readonly Removal[]): string {
  const places = new Map<string, Set<string>>();
  for (const removal of removals.filter((one) => one.name === name)) {
    const fields = places.get(removal.said) ?? new Set<string>();
    if (removal.field !== CATALOG) fields.add(removal.field);
    places.set(removal.said, fields);
  }
  return namePart(
    name,
    [...places].map(([place, fields]) => placeNote(place, [...fields])),
  );
}

/** Removes each name from every dependency field, catalog, override, resolution, trust list and patch entry. */
export function main(argv: string[], io: UpdateIo = updateIo()): number {
  if (argv.length === 0 || argv.some((arg) => arg.startsWith(OPTION_PREFIX)))
    return fail(io, [said(REMOVE_COMMAND, REMOVE_USAGE)], EXIT_USAGE);

  const root = findRoot(io.cwd) ?? io.cwd;
  const read = readWorkspace(root);
  if (!read.ok) {
    return fail(
      io,
      read.errors.map((error) => said(REMOVE_COMMAND, error)),
    );
  }
  const removals = removalsOf(root, read.workspace, argv);
  const absent = argv.find((name) => !removals.some((removal) => removal.name === name));
  if (absent !== undefined) return fail(io, [said(REMOVE_COMMAND, nothingDepends(absent))]);
  const files = editFiles(
    root,
    removals.map((removal) => ({ apply: (raw: unknown) => drop(raw, removal), file: removal.file })),
  );
  for (const removal of removals)
    if (removal.patch !== null) fs.rmSync(patchPath(root, removal.patch), { force: true });

  io.out(removedLine(argv.map((name) => partOf(name, removals))));
  return finish({ command: REMOVE_COMMAND, io, root }, files);
}
