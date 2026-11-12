import path from "node:path";

import { installedDir, markersIn, readVersion } from "./link-installed.ts";
import type { LinkContext } from "./link-io.types.ts";
import { readState } from "./link-state.ts";
import { MODULES, NEVER, NOT_INSTALLED, NO_LINKS, NPM_NONE, NPM_UNKNOWN, TIME_DIGITS } from "./link.constants.ts";

type Row = { name: string; source: string; npm: string; synced: string };

function clock(date: Date): string {
  return [date.getHours(), date.getMinutes()].map((part) => String(part).padStart(TIME_DIGITS, "0")).join(":");
}

/**
 * One row per link: the state's entries, plus any swapped dir whose entry a lost race dropped (the marker is the
 * truth).
 */
function rowsOf(ctx: LinkContext): Row[] {
  const root = ctx.roots.install;
  const state = readState(root);

  const kept = Object.entries(state).map(([name, entry]) => ({
    name,
    npm: entry.npm ?? NPM_NONE,
    source: entry.source,
    synced: clock(new Date(entry.syncedAt)),
  }));

  const lost = markersIn(root)
    .filter((marker) => !Object.hasOwn(state, marker.name))
    .map((marker) => ({ ...marker, npm: NPM_UNKNOWN, synced: NEVER }));

  return [...kept, ...lost].toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The lines `repo link status` prints: a count, then each link with its installed version, source and npm version. */
export function linkStatus(ctx: LinkContext): string[] {
  const rows = rowsOf(ctx);

  if (rows.length === 0) return [NO_LINKS];
  const width = Math.max(...rows.map((row) => row.name.length));
  const where = path.join(ctx.roots.install, MODULES);

  const lines = rows.map((row) => {
    const version = readVersion(installedDir(ctx.roots.install, row.name)) ?? NOT_INSTALLED;

    return `  ${row.name.padEnd(width)}  ${version}  from ${row.source}  (npm ${row.npm})  synced ${row.synced}`;
  });

  return [`${rows.length} ${rows.length === 1 ? "link" : "links"} in ${where}`, ...lines];
}
