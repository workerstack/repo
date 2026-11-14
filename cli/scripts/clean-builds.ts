/** `repo clean --build` and `--deps`: remove the ignored build output and report it. */
import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { loadConfig } from "../config.ts";
import { removeTree } from "../remove-tree.ts";
import { AFTER_DEPS, CLEAN_PREFIX } from "./build-dirs.constants.ts";
import { planBuild, removeBuild, type BuildItem } from "./build-dirs.ts";
import { size } from "./clean-run.ts";
import { BUILD_KINDS, BUILD_PLURAL } from "./clean.constants.ts";
import type { BuildRun } from "./clean.types.ts";

/** "a, b and c" over the non-empty kinds of `items`, else "0 build dirs". */
function buildParts(items: readonly BuildItem[]): string {
  const parts = BUILD_KINDS.map((kind) => ({
    count: items.filter((item) => item.kind === kind).length,
    names: BUILD_PLURAL[kind],
  }))
    .filter(({ count }) => count > 0)
    .map(({ count, names }) => `${count} ${names[Number(count !== 1)]}`);

  const last = parts.pop();

  if (last === undefined) return "0 build dirs";

  return [parts.join(", "), last].filter(Boolean).join(" and ");
}

/** The line `repo clean --build` and `--deps` end on: what was (or would be) removed, its size and the next step. */
function buildSummary(done: readonly BuildItem[], { deps, dryRun }: Pick<BuildRun, "deps" | "dryRun">): string {
  const verb = dryRun ? "would remove" : "removed";

  if (done.length === 0) return `${verb} ${buildParts(done)}`;
  const total = size(done.reduce((sum, item) => sum + item.bytes, 0));

  return `${verb} ${buildParts(done)} (${total})${deps ? AFTER_DEPS : ""}`;
}

/**
 * What `repo clean --build` and `--deps` run: plan, remove unless dryRun, report through `out`; returns the exit
 * code.
 */
export function cleanBuilds(run: BuildRun): number {
  const { root, deps, dryRun, names, out, rm = removeTree } = run;
  const plan = planBuild(root, { deps, extra: names });

  if (!plan.ok) {
    out(`${CLEAN_PREFIX}${plan.error}`);

    return 1;
  }

  function relOf(p: string): string {
    return path.relative(root, p).split(path.sep).join("/");
  }

  const { done, skipped } = removeBuild(plan.items, { dryRun, rm });

  if (dryRun) for (const item of done) out(relOf(item.path));

  for (const entry of skipped) out(`skipped ${relOf(entry.path)}: ${entry.code}`);
  out(buildSummary(done, { deps, dryRun }));

  return Math.min(skipped.length, 1);
}

/** The dir names the config adds, or the config's errors; no names when the repo has no config. */
export async function configuredNames(root: string): Promise<{ names: readonly string[] } | { errors: string[] }> {
  if (!fs.existsSync(path.join(root, CONFIG_FILE))) return { names: [] };
  const loaded = await loadConfig(root);

  return loaded.ok ? { names: loaded.config.clean?.build ?? [] } : { errors: loaded.errors };
}
