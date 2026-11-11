import fs from "node:fs";

import { installedDir, markersIn, readVersion } from "./link-installed.ts";
import type { LinkContext } from "./link-io.types.ts";
import { readState, writeState } from "./link-state.ts";
import { EXIT_FAIL, NOT_INSTALLED, NO_LINKS, installFailed, unlinkedLine } from "./link.constants.ts";

/** Which links a command takes out: one name, or every one the state or a marker knows. */
export type UnlinkScope = { all: true } | { all: false; name: string };

/** Runs install; on failure prints the reason and what install printed to stderr, and returns false. */
function installed(ctx: LinkContext, root: string): boolean {
  const result = ctx.io.install(root);
  if (result.code === 0) return true;
  ctx.io.err(`repo ${ctx.command}: ${installFailed(result.code)}`);
  for (const line of result.output.trimEnd().split("\n").filter(Boolean)) ctx.io.err(line);
  return false;
}

/**
 * Drops each named link's state entry and deletes its marked copy, writes the state, and only then runs install, so
 * the reapply that install's postinstall runs finds nothing to relink. Prints one line per link taken out, with the
 * npm version that is back; a name that is not linked, or no links at all, prints that nothing is linked.
 */
export function unlinkScope(ctx: LinkContext, scope: UnlinkScope): number {
  const root = ctx.roots.install;
  const state = readState(root);
  const marked = new Set(markersIn(root).map((marker) => marker.name));
  const known = [...new Set([...Object.keys(state), ...marked])].sort();
  const names = scope.all ? known : known.filter((name) => name === scope.name);
  if (names.length === 0) {
    ctx.io.out(NO_LINKS);
    return 0;
  }
  const npm = new Map(names.map((name) => [name, state[name]?.npm ?? null]));
  const removed = names.filter((name) => marked.has(name));
  for (const name of names) delete state[name];
  writeState(root, state);
  for (const name of removed) fs.rmSync(installedDir(root, name), { force: true, recursive: true });
  if (removed.length > 0 && !installed(ctx, root)) return EXIT_FAIL;
  for (const name of names)
    ctx.io.out(unlinkedLine(name, readVersion(installedDir(root, name)) ?? npm.get(name) ?? NOT_INSTALLED));

  return 0;
}
