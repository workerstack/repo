import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "./config.ts";
import { GENERATORS, type Output, type SyncContext } from "./sync/outputs.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** Where repo sync prints; each call gets whole lines. */
export type SyncIo = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };

type Mode = { check: boolean; postinstall: boolean };
type ModeResult = { ok: true; mode: Mode } | { ok: false; error: string };

const PREFIX = "repo sync: ";

/** Runs every generator in order; nothing is written, so all errors surface before any file changes. */
export function planSync(ctx: SyncContext): { outputs: Output[]; errors: string[] } {
  const outputs: Output[] = [];
  const errors: string[] = [];
  for (const generator of GENERATORS) {
    const result = generator(ctx);
    outputs.push(...result.outputs);
    errors.push(...result.errors);
  }
  return { outputs, errors };
}

/**
 * `repo sync [--check | --postinstall]`: validates the config and every output, then writes the outputs whose
 * bytes changed. `--check` writes nothing and fails on drift; `--postinstall` reports errors but exits 0.
 */
export async function runSync(args: string[], io: SyncIo): Promise<number> {
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

  // loadConfig reads the root package.json when packs are omitted, so a broken one is reported once, from there.
  const config = await loadConfig(root);
  if (!config.ok) return fail(config.errors);
  const workspace = readWorkspace(root);
  if (!workspace.ok) return fail(workspace.errors);

  const readErrors: string[] = [];
  const plan = planSync({
    root,
    config: config.config,
    workspace: workspace.workspace,
    read: (rel) => readText(root, rel, readErrors),
  });
  // An unreadable file reads as missing to the generators, so its error is the cause of anything they report.
  if (readErrors.length > 0) return fail(readErrors);
  if (plan.errors.length > 0) return fail(plan.errors);

  const changed = plan.outputs.filter((output) => !isCurrent(path.join(root, output.path), output.content));
  if (changed.length === 0) {
    io.stdout(`${PREFIX}up to date\n`);
    return 0;
  }
  if (check) {
    for (const output of changed) io.stderr(`${PREFIX}${output.path} is out of date; run \`bun repo sync\`\n`);
    return 1;
  }
  for (const output of changed) {
    const error = writeAtomic(path.join(root, output.path), output.content);
    if (error !== null) return fail([`${output.path}: cannot write: ${error}`]);
  }
  io.stdout(`${PREFIX}wrote ${changed.map((output) => output.path).join(", ")}\n`);
  return 0;
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
    fs.rmSync(temp, { force: true });
    return (error as Error).message;
  }
}
