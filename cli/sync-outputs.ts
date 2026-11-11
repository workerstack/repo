import fs from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import { canonicalPath } from "./scripts/workspace-root.ts";
import { errorCode, errorMessage } from "./sync-errors.ts";
import { NOT_FOUND_CODE, OWNER_EXECUTE } from "./sync.constants.ts";
import { gitFiles, type PostPass } from "./sync/git-files.ts";
import { stamp } from "./sync/header.ts";
import { normalizeRel } from "./sync/manifest.ts";
import { GENERATORS, type Generator, type Output, type SyncContext } from "./sync/outputs.ts";
import { standards } from "./sync/standards.ts";
import { withTailwindEntry } from "./sync/tailwind-entry.ts";
import type { Workspace } from "./sync/workspace.ts";
import { isCurrent } from "./sync/write.ts";

/** The passes over the generators' outputs: standards first, so the git files pass ignores its configs. */
export const POST_PASSES: readonly PostPass[] = [standards, gitFiles];

type Plan = { outputs: Output[]; errors: string[] };

/** The text of the last file output planned at `rel`, or null when none is. */
function plannedText(outputs: readonly Output[], rel: string): string | null {
  const wanted = path.posix.normalize(rel);
  let text: string | null = null;
  for (const output of outputs)
    if (output.kind === "file" && path.posix.normalize(output.path) === wanted) text = output.content;
  return text;
}

/**
 * Runs every generator in order, then each pass of `post` over their outputs and those of the passes before it;
 * nothing is written, so all errors surface before any file changes. A generator that fails on the file system
 * reports its message as an error, like any other it found. A generator reads a file an earlier one planned as that
 * planned text, so the README glues the INDEX this run writes, not the one on disk.
 */
export function planSync(
  ctx: SyncContext,
  generators: readonly Generator[] = GENERATORS,
  post: readonly PostPass[] = POST_PASSES,
): Plan {
  const plan: Plan = { errors: [], outputs: [] };
  const planner = new Map<string, string>();
  const collect = (label: string, run: () => Plan) => {
    try {
      const result = run();
      for (const output of result.outputs) {
        const first = planner.get(output.path);
        if (first === undefined) planner.set(output.path, label);
        else plan.errors.push(`${output.path}: planned by ${first} and ${label}; rename one`);
      }
      plan.outputs.push(...result.outputs);
      plan.errors.push(...result.errors);
    } catch (error) {
      plan.errors.push(errorMessage(error));
    }
  };
  const view: SyncContext = { ...ctx, read: (rel) => plannedText(plan.outputs, rel) ?? ctx.read(rel) };
  for (const generator of generators) collect(generator.name, () => generator(view));
  for (const pass of post) {
    const planned = [...plan.outputs];
    collect(pass.name, () => pass(ctx, planned));
  }
  return plan;
}

/** What `computeOutputs` plans from: the repo, its config and workspace, and the generators and passes to run. */
export type ComputeOpts = {
  root: string;
  config: ResolvedConfig;
  workspace: Workspace;
  generators?: readonly Generator[] | undefined;
  post?: readonly PostPass[] | undefined;
};

/** A root-relative file's text, or null when it is missing; any other failure is recorded in `errors`. */
function readText(root: string, rel: string, errors: string[]): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch (error) {
    if (errorCode(error) === NOT_FOUND_CODE) return null;
    errors.push(`${rel}: cannot read: ${errorMessage(error)}`);
    return null;
  }
}

/** A whole file output with sync's one header line, in its format's comment syntax; any other output as it is. */
function stamped(output: Output): Output {
  return output.kind === "file" && output.managed === "whole"
    ? { ...output, content: stamp(output.path, output.content) }
    : output;
}

/**
 * Every generator's outputs for what is on disk under `root` now, as normalized paths; the errors when any
 * generator or path is wrong.
 */
export function computeOutputs({
  root,
  config,
  workspace,
  generators,
  post,
}: ComputeOpts): { ok: true; outputs: Output[] } | { ok: false; errors: string[] } {
  // The tailwind entry is found once, here, so the standards pass gives oxlint and oxfmt the same sheet.
  const tailwind = config.packs.includes("standards")
    ? withTailwindEntry(root, config.lint)
    : { lint: config.lint, ok: true as const };
  if (!tailwind.ok) return { errors: tailwind.errors, ok: false };
  const readErrors: string[] = [];
  const ctx = {
    config: { ...config, lint: tailwind.lint },
    read: (rel: string) => readText(root, rel, readErrors),
    root,
    workspace,
  };
  const plan = planSync(ctx, generators, post);
  // An unreadable file reads as missing to the generators, so its error is the cause of anything they report.
  if (readErrors.length > 0) return { errors: readErrors, ok: false };
  if (plan.errors.length > 0) return { errors: plan.errors, ok: false };
  // One spelling per path: outputs and manifest entries are compared only in the normalized form.
  const normalized: Output[] = [];
  const badPaths: string[] = [];
  for (const output of plan.outputs) {
    const rel = normalizeRel(output.path, root);
    if (rel === null) badPaths.push(`${output.path}: not a path inside the repo`);
    else normalized.push(stamped({ ...output, path: rel }));
  }
  return badPaths.length > 0 ? { errors: badPaths, ok: false } : { ok: true, outputs: normalized };
}

/** Whether the owner may run the file at `abs`, which exists. */
function isExecutable(abs: string): boolean {
  return (fs.statSync(abs).mode & OWNER_EXECUTE) !== 0;
}

/** `abs` with its parent dirs in canonical spelling and its last segment as written. */
function parentCanonical(abs: string): string {
  return path.join(canonicalPath(path.dirname(abs)), path.basename(abs));
}

/**
 * Whether the output is on disk exactly as planned: same bytes for a file; for a link the same text, so a link
 * that reaches its target through another generated link is rewritten before that one is pruned. A win32
 * junction holds an absolute target, so it only has to name the same path once its parent dirs are resolved
 * (8.3 short names, drive case); its last segment is never followed, so a junction into another link is stale.
 */
export function isCurrentOutput(root: string, output: Output, platform: NodeJS.Platform): boolean {
  const abs = path.join(root, output.path);
  if (output.kind === "file") {
    // A hook git cannot run is out of date even with the right bytes; win32 has no execute bit.
    return isCurrent(abs, output.content) && (output.executable !== true || platform === "win32" || isExecutable(abs));
  }
  try {
    if (!fs.lstatSync(abs).isSymbolicLink()) return false;
    if (platform !== "win32") return fs.readlinkSync(abs) === output.target;
    const here = path.dirname(abs);
    return (
      parentCanonical(path.resolve(here, fs.readlinkSync(abs))) === parentCanonical(path.resolve(here, output.target))
    );
  } catch {
    return false;
  }
}
