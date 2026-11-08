import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "./config.ts";
import { canonicalPath } from "../.rulesync/scripts/workspace-root.ts";
import { MANIFEST_REL, normalizeRel, prunePaths, readManifest, renderManifest } from "./sync/manifest.ts";
import { applyMigration, conflictLines, planAdoption, planMigration } from "./sync/migrate.ts";
import { isSelf, stockRoot } from "./sync/stock.ts";
import { GENERATORS, type Generator, type Output, type SyncContext } from "./sync/outputs.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** Where repo sync prints; each call gets whole lines. */
export type SyncIo = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };

/** Seams for tests: the generators to run, the platform links are made for, and how one output is written. */
export type SyncDeps = {
  generators?: readonly Generator[];
  platform?: NodeJS.Platform;
  writeOutput?: (root: string, output: Output, platform: NodeJS.Platform) => string | null;
};

type Mode = { check: boolean; postinstall: boolean };
type ModeResult = { ok: true; mode: Mode } | { ok: false; error: string };

const PREFIX = "repo sync: ";

/**
 * Runs every generator in order; nothing is written, so all errors surface before any file changes. A generator
 * that fails on the file system reports its message as an error, like any other it found.
 */
export function planSync(
  ctx: SyncContext,
  generators: readonly Generator[] = GENERATORS,
): { outputs: Output[]; errors: string[] } {
  const outputs: Output[] = [];
  const errors: string[] = [];
  for (const generator of generators) {
    try {
      const result = generator(ctx);
      outputs.push(...result.outputs);
      errors.push(...result.errors);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  return { outputs, errors };
}

/**
 * `repo sync [--check | --postinstall]`: validates the config and every output, writes the outputs that changed,
 * removes what the last run wrote and no output names now, then records every output path in the manifest.
 * `--check` writes nothing and fails on drift; `--postinstall` reports errors but exits 0.
 */
export async function runSync(args: string[], io: SyncIo, deps: SyncDeps = {}): Promise<number> {
  const platform = deps.platform ?? process.platform;
  const write = deps.writeOutput ?? writeOutput;
  const parsed = parseMode(args);
  if (!parsed.ok) {
    io.stderr(`${PREFIX}${parsed.error}\n`);
    return 1;
  }
  const { check, postinstall } = parsed.mode;
  const fail = (errors: string[]): number => {
    for (const error of errors) io.stderr(`${PREFIX}${error}\n`);
    return postinstall ? 0 : 1;
  };

  const root = findRoot(io.cwd);
  if (root === null) return fail([`no ${CONFIG_FILE} in ${io.cwd} or any parent; run \`bun repo init\``]);

  let config = await loadConfig(root);
  if (!config.ok) return fail(config.errors);
  // Here the trees are the stock source; without the agents pack sync would prune them.
  if (isSelf(root) && !config.config.packs.includes("agents")) {
    return fail([`${CONFIG_FILE}: this repo ships the agent trees as its stock source; keep "agents" in packs`]);
  }

  let migrated = false;
  // A copied install moves to .repo/ and references/ before anything is planned from them; this repo never does.
  if (!isSelf(root)) {
    const steps = planMigration(root, stockRoot(root), config.config);
    const conflicts = conflictLines(steps);
    if (conflicts.length > 0) {
      for (const line of conflicts) io.stderr(`${line}\n`);
      return postinstall ? 0 : 1;
    }
    if (steps.length > 0 && check) {
      io.stderr(`${PREFIX}${steps.length} migration step${steps.length === 1 ? "" : "s"} pending; run \`bun repo sync\`\n`);
      return 1;
    }
    migrated = steps.length > 0;
    if (steps.length > 0) {
      try {
        for (const line of await applyMigration(root, steps)) io.stdout(`${line}\n`);
      } catch (error) {
        return fail([(error as Error).message]);
      }
      config = await loadConfig(root, { fresh: true });
      if (!config.ok) return fail(config.errors);
    }
  }
  const workspace = readWorkspace(root);
  if (!workspace.ok) return fail(workspace.errors);

  const resolved = config.config;
  /** Every generator's outputs for what is on disk now, as normalized paths; the errors when any generator or path is wrong. */
  const compute = (): { ok: true; outputs: Output[] } | { ok: false; errors: string[] } => {
    const readErrors: string[] = [];
    const plan = planSync(
      { root, config: resolved, workspace: workspace.workspace, read: (rel) => readText(root, rel, readErrors) },
      deps.generators,
    );
    // An unreadable file reads as missing to the generators, so its error is the cause of anything they report.
    if (readErrors.length > 0) return { ok: false, errors: readErrors };
    if (plan.errors.length > 0) return { ok: false, errors: plan.errors };
    // One spelling per path: outputs and manifest entries are compared only in the normalized form.
    const normalized: Output[] = [];
    const badPaths: string[] = [];
    for (const output of plan.outputs) {
      const rel = normalizeRel(output.path, root);
      if (rel === null) badPaths.push(`${output.path}: not a path inside the repo`);
      else normalized.push({ ...output, path: rel });
    }
    return badPaths.length > 0 ? { ok: false, errors: badPaths } : { ok: true, outputs: normalized };
  };

  let planned = compute();
  if (!planned.ok) return fail(planned.errors);

  // What a consumer already keeps where sync generates moves into `.repo/` before it is overwritten; a copied install did that in its migration.
  if (!isSelf(root) && !migrated) {
    const manifestPaths = readManifest(root).paths.flatMap((entry) => normalizeRel(entry, root) ?? []);
    const steps = planAdoption(root, stockRoot(root), resolved, planned.outputs, manifestPaths);
    const conflicts = conflictLines(steps);
    if (conflicts.length > 0) {
      for (const line of conflicts) io.stderr(`${line}\n`);
      return postinstall ? 0 : 1;
    }
    if (steps.length > 0 && check) {
      io.stderr(`${PREFIX}${steps.length} adoption step${steps.length === 1 ? "" : "s"} pending; run \`bun repo sync\`\n`);
      return 1;
    }
    if (steps.length > 0) {
      try {
        for (const line of await applyMigration(root, steps)) io.stdout(`${line}\n`);
      } catch (error) {
        return fail([(error as Error).message]);
      }
      // The overlay changed what the generators read.
      planned = compute();
      if (!planned.ok) return fail(planned.errors);
    }
  }
  const outputs = planned.outputs;

  const changed = outputs.filter((output) => !isCurrentOutput(root, output, platform));
  const prune = prunePaths(
    readManifest(root),
    outputs.map((output) => output.path),
    root,
  ).filter((rel) => isPrunable(path.join(root, rel)));
  const manifest = renderManifest(outputs.map((output) => output.path));
  if (check) {
    for (const output of changed) io.stderr(`${PREFIX}${output.path} is out of date; run \`bun repo sync\`\n`);
    for (const rel of prune) io.stderr(`${PREFIX}${rel} is stale and would be removed; run \`bun repo sync\`\n`);
    if (changed.length === 0 && prune.length === 0) io.stdout(`${PREFIX}up to date\n`);
    return changed.length === 0 && prune.length === 0 ? 0 : 1;
  }

  for (const output of changed) {
    const error = write(root, output, platform);
    if (error !== null) return fail([`${output.path}: cannot write: ${error}`]);
  }
  for (const rel of prune) {
    const error = removePath(root, rel);
    if (error !== null) return fail([`${rel}: cannot remove: ${error}`]);
  }
  // Last, so a run killed before here is redone from the old manifest and converges.
  if (!isCurrent(path.join(root, MANIFEST_REL), manifest)) {
    const error = writeAtomic(path.join(root, MANIFEST_REL), manifest);
    if (error !== null) return fail([`${MANIFEST_REL}: cannot write: ${error}`]);
  }
  const parts = [];
  if (changed.length > 0) parts.push(`wrote ${summarize(changed.map((output) => output.path))}`);
  if (prune.length > 0) parts.push(`removed ${summarize(prune)}`);
  io.stdout(`${PREFIX}${parts.length === 0 ? "up to date" : parts.join("; ")}\n`);
  return 0;
}

/** Writes one output: a file through a temp file and rename, a link replaced by a new one. Null on success. */
export function writeOutput(root: string, output: Output, platform: NodeJS.Platform): string | null {
  const abs = path.join(root, output.path);
  return output.kind === "file" ? writeAtomic(abs, output.content) : writeLink(abs, output.target, platform);
}

/** Path list for the summary line: outputs sharing a top dir collapse to `dir/ (n)`, single files keep their name. */
function summarize(paths: readonly string[]): string {
  const top = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : null);
  const counts = new Map<string, number>();
  for (const rel of paths) {
    const dir = top(rel);
    if (dir !== null) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const rel of paths) {
    const dir = top(rel);
    if (dir === null || counts.get(dir) === 1) parts.push(rel);
    else if (!seen.has(dir)) {
      parts.push(`${dir}/ (${counts.get(dir)})`);
      seen.add(dir);
    }
  }
  return parts.join(", ");
}

function parseMode(args: string[]): ModeResult {
  const mode: Mode = { check: false, postinstall: false };
  for (const arg of args) {
    if (arg === "--check") mode.check = true;
    else if (arg === "--postinstall") mode.postinstall = true;
    else return { ok: false, error: `unknown flag ${arg}; use --check or --postinstall` };
  }
  if (mode.check && mode.postinstall) return { ok: false, error: "use --check or --postinstall, not both" };
  return { ok: true, mode };
}

/** A root-relative file's text, or null when it is missing; any other failure is recorded in `errors`. */
function readText(root: string, rel: string, errors: string[]): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    errors.push(`${rel}: cannot read: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Whether the output is on disk exactly as planned: same bytes for a file; for a link the same text, so a link
 * that reaches its target through another generated link is rewritten before that one is pruned. A win32
 * junction holds an absolute target, so it only has to name the same path once its parent dirs are resolved
 * (8.3 short names, drive case); its last segment is never followed, so a junction into another link is stale.
 */
function isCurrentOutput(root: string, output: Output, platform: NodeJS.Platform): boolean {
  const abs = path.join(root, output.path);
  if (output.kind === "file") return isCurrent(abs, output.content);
  try {
    if (!fs.lstatSync(abs).isSymbolicLink()) return false;
    if (platform !== "win32") return fs.readlinkSync(abs) === output.target;
    const here = path.dirname(abs);
    return parentCanonical(path.resolve(here, fs.readlinkSync(abs))) === parentCanonical(path.resolve(here, output.target));
  } catch {
    return false;
  }
}

/** `abs` with its parent dirs in canonical spelling and its last segment as written. */
function parentCanonical(abs: string): string {
  return path.join(canonicalPath(path.dirname(abs)), path.basename(abs));
}

/** Whether a manifest path is on disk and removable: a file or a link; a real directory is left alone. */
function isPrunable(abs: string): boolean {
  try {
    return !fs.lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** Removes a file or link, then every parent dir it leaves empty, up to but never including the root. */
function removePath(root: string, rel: string): string | null {
  try {
    fs.rmSync(path.join(root, rel), { force: true });
    for (let dir = path.dirname(path.join(root, rel)); dir !== root; dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
    }
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Replaces whatever is at `abs` with a directory link; a junction with an absolute target on win32. */
function writeLink(abs: string, target: string, platform: NodeJS.Platform): string | null {
  try {
    fs.rmSync(abs, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (platform === "win32") fs.symlinkSync(path.resolve(path.dirname(abs), target), abs, "junction");
    else fs.symlinkSync(target, abs, "dir");
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Whether `file` already holds exactly the bytes of `content`; a missing or unreadable file is not current. */
function isCurrent(file: string, content: string): boolean {
  try {
    return fs.readFileSync(file).equals(Buffer.from(content));
  } catch {
    return false;
  }
}

/** Writes through a temp file in the same dir and a rename, so a crash never leaves a half-written output. */
function writeAtomic(file: string, content: string): string | null {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
    return null;
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // the temp file's dir is unusable, so there is no temp file to remove
    }
    return (error as Error).message;
  }
}
