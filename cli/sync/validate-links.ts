// Whether each planned link will point at something once sync has run.
import fs from "node:fs";
import path from "node:path";

import type { Output } from "./outputs.ts";

/** The planned links by path to target, and every planned file path with each dir above it. */
export type LinkPlan = { links: ReadonlyMap<string, string>; planned: ReadonlySet<string> };

/** The links and planned paths of `outputs`: a planned file also plans every dir above it. */
export function planLinks(outputs: readonly Output[]): LinkPlan {
  const links = new Map<string, string>();
  const planned = new Set<string>();

  for (const output of outputs) {
    if (output.kind === "link") links.set(output.path, output.target);
    else planned.add(output.path);
  }

  for (const rel of planned)
    for (let dir = path.posix.dirname(rel); dir !== "."; dir = path.posix.dirname(dir)) planned.add(dir);

  return { links, planned };
}

/** One step of a link walk: the planned link at `rel`, under `root`, past the links in `seen`. */
type Hop = { root: string; plan: LinkPlan; rel: string; seen: Set<string> };

/**
 * Whether the link planned at `rel` will point at something once sync has run: its target is on disk, a planned
 * output, or the dir above one; a target that is itself a planned link is followed.
 */
function resolves(hop: Hop): boolean {
  const { root, plan, rel, seen } = hop;
  // Every rel walked is a planned link's path, so its target is always there.
  const linkTarget = String(plan.links.get(rel));

  const target = path
    .relative(root, path.resolve(root, path.dirname(rel), linkTarget))
    .split(path.sep)
    .join("/");

  if (fs.existsSync(path.join(root, target)) || plan.planned.has(target)) return true;

  if (!plan.links.has(target) || seen.has(target)) return false;

  return resolves({ plan, rel: target, root, seen: seen.add(target) });
}

/** `path: link target ... does not exist` for a planned link that will not resolve under `root`; null when it will. */
export function linkProblem(root: string, output: Extract<Output, { kind: "link" }>, plan: LinkPlan): string | null {
  const ok = resolves({ plan, rel: output.path, root, seen: new Set([output.path]) });

  return ok ? null : `${output.path}: link target ${output.target} does not exist`;
}
