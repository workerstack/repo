/** `repo link` swaps a dependency for a packed sibling checkout; `repo unlink` puts npm back. */
import fs from "node:fs";
import path from "node:path";

import { applyLinks } from "./apply-links.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { loadConfig } from "./config.ts";
import { dependencyNames } from "./dependency-names.ts";
import { findRoots } from "./find-roots.ts";
import { LinkError } from "./link-error.ts";
import { linkIo } from "./link-io.ts";
import type { LinkContext, LinkIo } from "./link-io.types.ts";
import { resolveTargets, type LinkLookup } from "./link-siblings.ts";
import { linkStatus } from "./link-status.ts";
import { unlinkScope, type UnlinkScope } from "./link-unlink.ts";
import {
  CMD_LINK,
  CMD_STATUS,
  CMD_UNLINK,
  FLAG_PRE_PUSH,
  EXIT_FAIL,
  EXIT_USAGE,
  FLAG_ALL,
  MODULES,
  OPTION_PREFIX,
  USAGE,
  noInstall,
} from "./link.constants.ts";
import { prePush } from "./pre-push.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** The config's `link` map and the dependency names of this checkout's package.json files. */
async function lookupOf(ctx: LinkContext): Promise<LinkLookup> {
  const { checkout } = ctx.roots;
  let mapped = {};

  if (fs.existsSync(path.join(checkout, CONFIG_FILE))) {
    const loaded = await loadConfig(checkout);

    if (!loaded.ok) throw new LinkError(loaded.errors.join("\n"));
    mapped = loaded.config.link ?? {};
  }

  const read = readWorkspace(checkout);

  if (!read.ok) throw new LinkError(read.errors.join("\n"));
  const { manifest, packages } = read.workspace;
  const used = new Set([manifest, ...packages.map((pkg) => pkg.manifest)].flatMap(dependencyNames));

  return { mapped, roots: ctx.roots, used };
}

async function link(ctx: LinkContext, name: string): Promise<number> {
  if (!fs.existsSync(path.join(ctx.roots.install, MODULES))) throw new LinkError(noInstall(ctx.roots.install));
  const targets = resolveTargets(name, await lookupOf(ctx));

  return applyLinks(ctx, targets);
}

function isName(arg: string | undefined): arg is string {
  return arg !== undefined && !arg.startsWith(OPTION_PREFIX);
}

async function execute(ctx: LinkContext, run: () => Promise<number> | number): Promise<number> {
  try {
    return await run();
  } catch (error) {
    ctx.io.err(`repo ${ctx.command}: ${(error /* the steps throw Errors */ as Error).message}`);

    return EXIT_FAIL;
  }
}

function usage(ctx: LinkContext): number {
  ctx.io.err(`repo link: ${USAGE}`);

  return EXIT_USAGE;
}

function status(ctx: LinkContext): number {
  for (const line of linkStatus(ctx)) ctx.io.out(line);

  return 0;
}

function scopeOf(arg: string): UnlinkScope | null {
  if (arg === FLAG_ALL) return { all: true };

  return isName(arg) ? { all: false, name: arg } : null;
}

/**
 * `repo link <name>` packs the sibling checkout that publishes the package `name` (or every package a sibling dir
 * `name` publishes that this repo uses) and swaps it into the install dir; `repo link status` lists the links.
 */
export function main(argv: string[], io: LinkIo = linkIo()): number | Promise<number> {
  const ctx: LinkContext = { command: CMD_LINK, io, roots: findRoots(io) };
  const [arg, ...rest] = argv;

  if (rest.length > 0) return usage(ctx);

  if (arg === CMD_STATUS) return execute(ctx, () => status(ctx));

  if (arg === FLAG_PRE_PUSH) return execute(ctx, () => prePush(ctx));

  return isName(arg) ? execute(ctx, () => link(ctx, arg)) : usage(ctx);
}

/** `repo unlink <name>` or `repo unlink --all` puts npm back for the links named. */
export function unlinkMain(argv: string[], io: LinkIo = linkIo()): number | Promise<number> {
  const ctx: LinkContext = { command: CMD_UNLINK, io, roots: findRoots(io) };
  const [arg, ...rest] = argv;
  const scope = rest.length > 0 || arg === undefined ? null : scopeOf(arg);

  return scope === null ? usage(ctx) : execute(ctx, () => unlinkScope(ctx, scope));
}
