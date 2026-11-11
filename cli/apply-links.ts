import fs from "node:fs";
import path from "node:path";

import { depWarnings } from "./dep-warnings.ts";
import { LinkError } from "./link-error.ts";
import { npmBefore } from "./link-installed.ts";
import type { LinkContext, LinkTarget } from "./link-io.types.ts";
import { readState, writeState } from "./link-state.ts";
import {
  EXIT_FAIL,
  MODULES,
  NPM_NONE,
  linkedLine,
  npmHad,
  packFailed,
  siblingNoInstall,
  undoLine,
} from "./link.constants.ts";
import { syncPackage } from "./sync-package.ts";

/** Links one package: packs it, swaps it in, records it, and prints what happened. */
async function linkOne(ctx: LinkContext, target: LinkTarget): Promise<number> {
  const root = ctx.roots.install;
  if (!fs.existsSync(path.join(target.checkout, MODULES))) throw new LinkError(siblingNoInstall(target.checkout));
  const npm = npmBefore(root, target.name, readState(root)[target.name]?.npm ?? null);
  let manifest;
  try {
    manifest = await syncPackage(root, target);
  } catch (error) {
    const { message } = error /* the pack and file steps throw Errors */ as Error;
    ctx.io.err(`repo ${ctx.command}: ${packFailed(target.name, message)}`);
    return EXIT_FAIL;
  }
  const state = readState(root);
  state[target.name] = { npm, source: target.dir, syncedAt: ctx.io.now().toISOString() };
  writeState(root, state);
  ctx.io.out(`${linkedLine(target.name, manifest.version, target.dir)}${npmHad(npm ?? NPM_NONE)}`);
  for (const warning of depWarnings(root, manifest)) ctx.io.out(warning);
  ctx.io.out(undoLine(target.name));
  return 0;
}

/** Links each target; exits 1 when any failed to pack, after the rest have been tried. */
export async function applyLinks(ctx: LinkContext, targets: readonly LinkTarget[]): Promise<number> {
  const [first, ...rest] = targets;
  if (first === undefined) return 0;
  // One at a time: each link rewrites the one state file.
  const code = await linkOne(ctx, first);
  return Math.max(code, await applyLinks(ctx, rest));
}
