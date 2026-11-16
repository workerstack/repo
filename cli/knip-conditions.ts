/**
 * The export conditions knip runs under: those the workspace's tsconfig.json files name in `customConditions`. knip
 * loads each tool's config (a vite.config.ts, say), and a config that imports a workspace package by a source-only
 * condition fails to load without it, as tsc resolves it only with that condition set.
 */
import fs from "node:fs";
import path from "node:path";

import { parse } from "jsonc-parser";
import { z } from "zod";

import type { Workspace } from "./sync/workspace.ts";

const TSCONFIG = "tsconfig.json";

function conditionsSchema() {
  return z.looseObject({
    compilerOptions: z.looseObject({ customConditions: z.array(z.string()).optional() }).optional(),
  });
}

/** The `customConditions` the tsconfig.json in `dir` sets itself; none when it has no file or sets none. */
function ownConditions(dir: string): readonly string[] {
  const file = path.join(dir, TSCONFIG);

  if (!fs.existsSync(file)) return [];
  const parsed = conditionsSchema().safeParse(parse(fs.readFileSync(file, "utf8")));

  return parsed.success ? (parsed.data.compilerOptions?.customConditions ?? []) : [];
}

/** Each condition the root's and the packages' tsconfig.json set in `customConditions`, once, in the order found. */
export function customConditionsOf(workspace: Workspace): string[] {
  const dirs = [workspace.root, ...workspace.packages.map((pkg) => path.join(workspace.root, pkg.dir))];

  return [...new Set(dirs.flatMap(ownConditions))];
}

/** The bun arguments that run `bin` with `args` under `conditions`, one `--conditions` flag each. */
export function conditionedArgs(conditions: readonly string[], bin: string, args: readonly string[]): string[] {
  return [...conditions.map((condition) => `--conditions=${condition}`), bin, ...args];
}
