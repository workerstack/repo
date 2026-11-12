import fs from "node:fs";
import path from "node:path";

import type { LinkIo, LinkRoots } from "./link-io.types.ts";
import { MODULES } from "./link.constants.ts";

const TOPLEVEL = ["rev-parse", "--show-toplevel"];
const COMMON_DIR = ["rev-parse", "--path-format=absolute", "--git-common-dir"];

/**
 * The directories a command works between. The install root is this checkout when it has its own install dir, else
 * the main checkout (the choice `repoBinLookup` makes for hooks); siblings sit beside the main checkout, so a worktree
 * finds the same ones. Outside git, the current directory stands for both checkouts.
 */
export function findRoots(io: LinkIo): LinkRoots {
  const checkout = io.git(io.cwd, TOPLEVEL) ?? io.cwd;
  const common = io.git(io.cwd, COMMON_DIR);
  const main = common === null ? checkout : path.dirname(common);
  const install = fs.existsSync(path.join(checkout, MODULES)) ? checkout : main;

  return { checkout, install, main, siblings: path.dirname(main) };
}
