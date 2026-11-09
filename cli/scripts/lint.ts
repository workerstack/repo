import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "../config.ts";
import { OXLINT_CONFIG_PATH } from "../sync/oxlint-config.ts";
import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import { childEnv, readEnv } from "../env.ts";

/** The pinned tools the standards pack runs. */
export type Tool = "oxlint" | "oxfmt";
/** Runs `tool` with `args` in `root` and returns its exit code. */
export type RunTool = (tool: Tool, args: string[], root: string) => number;
export type ToolDeps = { cwd?: string; stderr?: (s: string) => void; run?: RunTool };

const COMMAND: Record<Tool, string> = { oxlint: "lint", oxfmt: "fmt" };
const CONFIG: Record<Tool, string> = { oxlint: OXLINT_CONFIG_PATH, oxfmt: OXFMT_CONFIG_PATH };

/**
 * `repo lint` and `repo fmt`: the pinned tool, run in the repo root with the arguments given, once the config
 * loads with the standards pack on and sync has written the tool's config. Its exit code is returned as is.
 */
export async function runTool(tool: Tool, args: string[], deps: ToolDeps = {}): Promise<number> {
  const { cwd = process.cwd(), stderr = (s: string) => process.stderr.write(s), run = spawnTool } = deps;
  const fail = (lines: string[]): number => {
    for (const line of lines) stderr(`repo ${COMMAND[tool]}: ${line}\n`);
    return 1;
  };
  const root = findRoot(cwd);
  if (root === null) return fail([`no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\``]);
  const loaded = await loadConfig(root);
  if (!loaded.ok) return fail(loaded.errors);
  if (!loaded.config.packs.includes("standards"))
    return fail([`the standards pack is off; add "standards" to packs in ${CONFIG_FILE}`]);
  if (!fs.existsSync(path.join(root, CONFIG[tool])))
    return fail([`no ${CONFIG[tool]}; run \`bun repo sync\` to write it`]);
  return run(tool, args, root);
}

export const lint = (argv: string[]): Promise<number> => runTool("oxlint", argv);
export const fmt = (argv: string[]): Promise<number> => runTool("oxfmt", argv);

/** The file a package export resolves to, from this package's install. */
function resolved(specifier: string): string {
  // Bun.resolveSync, not import.meta.resolve: vitest's transform drops the latter, and tests run this in-process.
  return Bun.resolveSync(specifier, import.meta.dirname);
}

/** The tool's bin script, read from its package.json; it is a node shim, so bun runs it. */
function binOf(tool: Tool): string {
  const manifest = resolved(`${tool}/package.json`);
  const { bin } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin: Record<string, string> };
  return path.join(path.dirname(manifest), bin[tool] as string);
}

/** What a captured run printed and its exit code. */
export type Captured = { code: number; stdout: string; stderr: string };

/**
 * The node_modules dir holding `@workerstack/repo` for this package at `packageRoot`: the one its scope dir sits in
 * when installed (bunx, a consumer), else the root's own, which a dev checkout fills with a self-link.
 */
export function pluginModules(packageRoot: string): string {
  const modules = path.dirname(path.dirname(packageRoot));
  return path.basename(modules) === "node_modules" ? modules : path.join(packageRoot, "node_modules");
}

/**
 * What oxlint needs beyond the inherited environment: the native tsgolint binary, which its own lookup would reach
 * through a node shim, and a NODE_PATH led by the node_modules holding this package, so the config's
 * `@workerstack/repo/lint` plugin loads in a repo with no install of its own.
 */
function oxlintEnv(): NodeJS.ProcessEnv {
  const exe = process.platform === "win32" ? ".exe" : "";
  const modules = pluginModules(path.resolve(import.meta.dirname, "..", ".."));
  const inherited = readEnv().NODE_PATH;
  return {
    OXLINT_TSGOLINT_PATH: resolved(`@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${exe}`),
    NODE_PATH: inherited ? `${modules}${path.delimiter}${inherited}` : modules,
  };
}

/** The bun command line and environment that run `tool`. */
function commandOf(tool: Tool): { args: string[]; env: NodeJS.ProcessEnv } {
  return { args: [binOf(tool)], env: childEnv(tool === "oxlint" ? oxlintEnv() : {}) };
}

/** Spawns bun on the tool's bin, output straight to the terminal. */
function spawnTool(tool: Tool, args: string[], root: string): number {
  const command = commandOf(tool);
  const result = spawnSync(process.execPath, [...command.args, ...args], {
    cwd: root,
    stdio: "inherit",
    env: toolEnv(command.env),
  });
  return result.status ?? 1;
}

/**
 * `env` without any `GIT_*` variable. Git hands a hook GIT_DIR, GIT_INDEX_FILE and more; a tool run from one that
 * kept them would aim every git call it makes, a test's `git init` in its own temp dir included, at the repo being
 * committed.
 */
export function toolEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_")));
}

/**
 * Runs bun with `args` in `cwd`, its output captured instead of printed, with no `GIT_*` variable (`toolEnv`). The
 * output goes to files, not pipes: a node script that exits right after writing (oxlint's json report) loses what a
 * pipe had not yet taken.
 */
export function captureBun(args: string[], cwd: string, env: NodeJS.ProcessEnv = childEnv()): Captured {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-capture-"));
  const files = { stdout: path.join(dir, "stdout"), stderr: path.join(dir, "stderr") };
  const out = fs.openSync(files.stdout, "w");
  const err = fs.openSync(files.stderr, "w");
  try {
    const result = spawnSync(process.execPath, args, { cwd, env: toolEnv(env), stdio: ["ignore", out, err] });
    const read = (file: string) => fs.readFileSync(file, "utf8");
    return { code: result.status ?? 1, stdout: read(files.stdout), stderr: read(files.stderr) };
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The tool run as `repo lint` or `repo fmt` runs it, in `root`, its output captured instead of printed. */
export function captureTool(tool: Tool, args: string[], root: string): Captured {
  const command = commandOf(tool);
  return captureBun([...command.args, ...args], root, command.env);
}
