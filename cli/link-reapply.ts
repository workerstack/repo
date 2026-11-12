import fs from "node:fs";
import path from "node:path";

import { findRoots } from "./find-roots.ts";
import { npmBefore } from "./link-installed.ts";
import { linkIo } from "./link-io.ts";
import type { LinkContext, LinkIo } from "./link-io.types.ts";
import { readState, writeState, type LinkEntry, type LinkState } from "./link-state.ts";
import { MODULES, WARNING_PREFIX, goneLine, packFailed, relinkedLine } from "./link.constants.ts";
import { syncPackage } from "./sync-package.ts";

async function relinkOne(ctx: LinkContext, state: LinkState, [name, entry]: [string, LinkEntry]): Promise<void> {
  const root = ctx.roots.install;

  if (!fs.existsSync(entry.source)) {
    ctx.io.err(goneLine(name, entry.source));

    return;
  }

  const npm = npmBefore(root, name, entry.npm);

  try {
    const manifest = await syncPackage(root, { checkout: entry.source, dir: entry.source, name });
    state[name] = { npm, source: entry.source, syncedAt: ctx.io.now().toISOString() };
    writeState(root, state);
    ctx.io.out(relinkedLine(name, manifest.version, entry.source));
  } catch (error) {
    ctx.io.err(
      `${WARNING_PREFIX}${packFailed(name, (error /* the pack and file steps throw Errors */ as Error).message)}`,
    );
  }
}

/**
 * Puts every recorded link back into the install root after an install replaced it with npm's copy: packs each source
 * again, records the npm version the install brought, and warns (never fails) for a source that is gone or will not
 * pack. Idempotent: with the links already in place it swaps in the same content and prints the same lines.
 */
/** Relinks `entries` one at a time, in order, stopping at the first failure. */
async function relinkFrom(ctx: LinkContext, state: LinkState, entries: [string, LinkEntry][]): Promise<void> {
  const [first, ...rest] = entries;

  if (first === undefined) return;
  await relinkOne(ctx, state, first);
  await relinkFrom(ctx, state, rest);
}

export async function reapplyLinks(io: LinkIo): Promise<number> {
  const ctx: LinkContext = { command: "link", io, roots: findRoots(io) };

  if (!fs.existsSync(path.join(ctx.roots.install, MODULES))) return 0;

  try {
    const state = readState(ctx.roots.install);
    const named = Object.entries(state).toSorted(([a], [b]) => a.localeCompare(b));
    // One at a time: each relink rewrites the one state file.
    await relinkFrom(ctx, state, named);
  } catch (error) {
    io.err(`${WARNING_PREFIX}${(error /* reading the state throws Errors */ as Error).message}`);
  }

  return 0;
}

/** `reapplyLinks` from `cwd`, printing through the given writers; what `repo sync --postinstall` runs. */
export function reapplyAt(
  cwd: string,
  writers: { stdout: (text: string) => void; stderr: (text: string) => void },
): Promise<number> {
  function out(line: string): void {
    return writers.stdout(`${line}\n`);
  }

  function err(line: string): void {
    return writers.stderr(`${line}\n`);
  }

  return reapplyLinks({ ...linkIo(), cwd, err, out });
}
