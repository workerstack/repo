import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "./config.constants.ts";
import { loadConfig } from "./config.ts";
import { dependencyNames } from "./dependency-names.ts";
import { LinkError } from "./link-error.ts";
import { markersIn } from "./link-installed.ts";
import type { LinkContext } from "./link-io.types.ts";
import { readState } from "./link-state.ts";
import {
  DEFAULT_LINK_PUSH,
  EXIT_FAIL,
  WARNING_PREFIX,
  allowedPush,
  refusedPush,
  type LinkPush,
} from "./link.constants.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** The checkout's `link.push`; "block" when it has no repo.config.ts. */
async function pushOf(checkout: string): Promise<LinkPush> {
  if (!fs.existsSync(path.join(checkout, CONFIG_FILE))) return DEFAULT_LINK_PUSH;
  const loaded = await loadConfig(checkout);

  if (!loaded.ok) throw new LinkError(loaded.errors.join("\n"));

  return loaded.config.link.push;
}

/**
 * The push check, for a public package of this checkout (its root or a workspace package with `private` not true)
 * that depends on a package linked in the install root. Under `link.push: "block"` it refuses (exit 1, one line per
 * pair); under "allow" it warns once per pair and passes. Silent when nothing is linked.
 */
export async function prePush(ctx: LinkContext): Promise<number> {
  const root = ctx.roots.install;
  const linked = new Set([...Object.keys(readState(root)), ...markersIn(root).map((marker) => marker.name)]);

  if (linked.size === 0) return 0;
  const read = readWorkspace(ctx.roots.checkout);

  if (!read.ok) throw new LinkError(read.errors.join("\n"));
  const { manifest, packages } = read.workspace;
  const isAllowed = (await pushOf(ctx.roots.checkout)) === "allow";
  let code = 0;

  for (const pkg of [manifest, ...packages.map((entry) => entry.manifest)]) {
    if (pkg.name === undefined || pkg.private === true) continue;

    for (const dep of dependencyNames(pkg).filter((name) => linked.has(name))) {
      if (isAllowed) {
        ctx.io.err(`${WARNING_PREFIX}${allowedPush(pkg.name, dep)}`);
        continue;
      }

      ctx.io.err(`repo ${ctx.command}: ${refusedPush(pkg.name, dep)}`);
      code = EXIT_FAIL;
    }
  }

  return code;
}
