import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "../config.ts";
import { OXFMT_CONFIG_PATH, OXLINT_CONFIG_PATH } from "../sync/standards.ts";

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

/**
 * Spawns bun on the tool's bin, output straight to the terminal. oxlint gets the native tsgolint binary, which
 * its own lookup would reach through a node shim.
 */
function spawnTool(tool: Tool, args: string[], root: string): number {
  const exe = process.platform === "win32" ? ".exe" : "";
  const tsgolint =
    tool === "oxlint"
      ? { OXLINT_TSGOLINT_PATH: resolved(`@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${exe}`) }
      : {};
  const result = spawnSync(process.execPath, [binOf(tool), ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...tsgolint },
  });
  return result.status ?? 1;
}
