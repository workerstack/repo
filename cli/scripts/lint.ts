import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WINDOWS_PLATFORM } from "../actionlint.constants.ts";
import { CONFIG_FILE } from "../config.constants.ts";
import { findRoot, loadConfig } from "../config.ts";
import { childEnv, readEnv } from "../env.ts";
import { cargoFmt } from "../rust/cargo-fmt.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { CARGO_MANIFEST } from "../rust/rust-hits.constants.ts";
import { OXLINT_CONFIG_PATH } from "../sync/oxlint-config.ts";
import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import { FIX_HINT } from "./json-keys.constants.ts";
import { repoJson, sortJson } from "./json-keys.ts";
import { OWN_LINE_MESSAGE } from "./jsonc-comments.constants.ts";
import { convertJsonc, type OwnLine } from "./jsonc-comments.ts";
import { CHECK_FLAG } from "./lint.constants.ts";
import { toolEnv } from "./tool-env.ts";

/** The pinned tools the standards pack runs. */
export type Tool = "oxlint" | "oxfmt";
/** Runs `tool` with `args` in `root` and returns its exit code. */
export type RunTool = (tool: Tool, args: string[], root: string) => number;
/** `cargo` runs `cargo fmt`; tests hand their own, and `stdout` receives its diff. */
export type ToolDeps = {
  cwd?: string;
  stderr?: (s: string) => void;
  stdout?: (s: string) => void;
  run?: RunTool;
  cargo?: CargoRun;
};

const COMMAND: Record<Tool, string> = { oxfmt: "fmt", oxlint: "lint" };
const CONFIG: Record<Tool, string> = { oxfmt: OXFMT_CONFIG_PATH, oxlint: OXLINT_CONFIG_PATH };

/** Names each file `--check` found an own-line block comment in. */
function reportComments(found: readonly OwnLine[], stderr: (s: string) => void): void {
  for (const { file, line } of found) stderr(`repo fmt: ${file} ${OWN_LINE_MESSAGE} ${line}; ${FIX_HINT}\n`);
}

/**
 * `repo fmt`'s conversion of own-line block comments in json, its sort of json keys, then the formatter: the json
 * files under the paths given (all, with none) have their keys sorted, or under `--check` only named on stderr, and the tool then runs on `args` as it was given. A
 * tree with a key out of order fails the check even when the tool passes.
 */
function formatSorted(job: {
  root: string;
  cwd: string;
  args: string[];
  stderr: (s: string) => void;
  run: RunTool;
}): number {
  const { root, cwd, args, stderr, run } = job;
  const paths = args
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => path.relative(root, path.resolve(cwd, arg)).split(path.sep).join("/"));
  const scope = paths.length === 0 ? null : paths;
  const listed = repoJson(root, scope);
  const check = args.includes(CHECK_FLAG);
  const commented = convertJsonc(root, listed.files, check);
  if (check) reportComments(commented, stderr);
  const sorted = sortJson(root, listed.files, check);
  if (!sorted.ok) {
    stderr(`repo fmt: ${sorted.error}\n`);
    return 1;
  }
  if (check) {
    for (const { file, key } of sorted.found)
      stderr(`repo fmt: ${file} has keys out of order, first "${key}"; ${FIX_HINT}\n`);
  }
  const code = run("oxfmt", args, root);
  return code === 0 && (sorted.found.length > 0 || commented.length > 0) && check ? 1 : code;
}

/**
 * `repo lint` and `repo fmt`: the pinned tool, run in the repo root with the arguments given, once the config
 * loads with the standards pack on and sync has written the tool's config. Its exit code is returned as is, except
 * that `repo fmt --check` also fails on a json key out of order. `repo fmt` in a repo with a root Cargo.toml then runs
 * `cargo fmt --all` (with `--check` when given), and fails on its exit code when oxfmt passed.
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
  if (tool !== "oxfmt") return run(tool, args, root);
  return withCargoFmt(root, formatSorted({ args, cwd, root, run, stderr }), { ...deps, args, stderr });
}

/** `code`, the exit of oxfmt, folded with that of `cargo fmt --all` when `root` has a Cargo.toml: the first failure. */
function withCargoFmt(
  root: string,
  code: number,
  job: ToolDeps & { args: string[]; stderr: (s: string) => void },
): number {
  if (!fs.existsSync(path.join(root, CARGO_MANIFEST))) return code;
  const { args, stderr, stdout = (s: string) => process.stdout.write(s) } = job;
  const rust = cargoFmt(root, { check: args.includes(CHECK_FLAG), run: job.cargo, stderr, stdout });
  return code === 0 ? rust : code;
}

export const lint = (argv: string[]): Promise<number> => runTool("oxlint", argv);
export const fmt = (argv: string[], deps: ToolDeps = {}): Promise<number> => runTool("oxfmt", argv, deps);

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

/** The package export of the native tsgolint binary for a platform and arch; Windows' ends in `.exe`. */
export function tsgolintSpecifier(platform: NodeJS.Platform, arch: string): string {
  return `@oxlint-tsgolint/${platform}-${arch}/tsgolint${platform === WINDOWS_PLATFORM ? ".exe" : ""}`;
}

/**
 * What oxlint needs beyond the inherited environment: the native tsgolint binary, which its own lookup would reach
 * through a node shim, and a NODE_PATH led by the node_modules holding this package, so the config's
 * `@workerstack/repo/lint` plugin loads in a repo with no install of its own.
 */
function oxlintEnv(): NodeJS.ProcessEnv {
  const modules = pluginModules(path.resolve(import.meta.dirname, "..", ".."));
  const inherited = readEnv().NODE_PATH;
  return {
    NODE_PATH: inherited ? `${modules}${path.delimiter}${inherited}` : modules,
    OXLINT_TSGOLINT_PATH: resolved(tsgolintSpecifier(process.platform, process.arch)),
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
    env: toolEnv(command.env),
    stdio: "inherit",
  });
  return result.status ?? 1;
}

/**
 * Runs bun with `args` in `cwd`, its output captured instead of printed, with no `GIT_*` variable (`toolEnv`). The
 * output goes to files, not pipes: a node script that exits right after writing (oxlint's json report) loses what a
 * pipe had not yet taken.
 */
export function captureBun(args: string[], cwd: string, env: NodeJS.ProcessEnv = childEnv()): Captured {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-capture-"));
  const files = { stderr: path.join(dir, "stderr"), stdout: path.join(dir, "stdout") };
  const out = fs.openSync(files.stdout, "w");
  const err = fs.openSync(files.stderr, "w");
  try {
    const result = spawnSync(process.execPath, args, { cwd, env: toolEnv(env), stdio: ["ignore", out, err] });
    const read = (file: string) => fs.readFileSync(file, "utf8");
    return { code: result.status ?? 1, stderr: read(files.stderr), stdout: read(files.stdout) };
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/** The tool run as `repo lint` or `repo fmt` runs it, in `root`, its output captured instead of printed. */
export function captureTool(tool: Tool, args: string[], root: string): Captured {
  const command = commandOf(tool);
  return captureBun([...command.args, ...args], root, command.env);
}

/** The comment conversion, the sort of json keys, then oxfmt, on `files` as `repo turn` runs them; a refusal to sort fails. */
export function captureSorted(files: readonly string[], root: string): Captured {
  convertJsonc(root, files, false);
  const sorted = sortJson(root, files, false);
  if (!sorted.ok) return { code: 1, stderr: `repo turn: ${sorted.error}\n`, stdout: "" };
  return captureTool("oxfmt", ["--no-error-on-unmatched-pattern", ...files], root);
}
