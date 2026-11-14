import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WINDOWS_PLATFORM } from "../actionlint.constants.ts";
import { CONFIG_FILE } from "../config.constants.ts";
import { findRoot, loadConfig, missingConfig } from "../config.ts";
import { childEnv } from "../env.ts";
import { removeTree } from "../remove-tree.ts";
import { repoEnv } from "../repo-env.ts";
import { cargoFmt } from "../rust/cargo-fmt.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { CARGO_MANIFEST } from "../rust/rust-hits.constants.ts";
import { OXLINT_CONFIG_PATH } from "../sync/oxlint-config.ts";
import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import { FIX_HINT } from "./json-keys.constants.ts";
import { repoJson, sortJson } from "./json-keys.ts";
import { OWN_LINE_MESSAGE } from "./jsonc-comments.constants.ts";
import { convertJsonc, type OwnLine } from "./jsonc-comments.ts";
import { BUN_FMT_ARGS, CHECK_FLAG, INIT_FLAG, INIT_REFUSAL, MODULES_DIR, NOT_FOUND } from "./lint.constants.ts";
import { packageBin } from "./package-bin.ts";
import { toolEnv } from "./tool-env.ts";

/** The tools the standards pack runs: the pinned oxlint, and the formatter of the bun running this. */
export type Tool = "oxlint" | "bun fmt";

/** Runs `tool` with `args` in `root` and returns its exit code, or a promise of it for a tool still running. */
export type RunTool = (tool: Tool, args: string[], root: string) => number | Promise<number>;

/** `cargo` runs `cargo fmt`; tests hand their own, and `stdout` receives its diff. */
export type ToolDeps = {
  cwd?: string;
  stderr?: (s: string) => void;
  stdout?: (s: string) => void;
  run?: RunTool;
  cargo?: CargoRun;
};

const COMMAND: Record<Tool, string> = { "bun fmt": "fmt", oxlint: "lint" };
const CONFIG: Record<Tool, string> = { "bun fmt": OXFMT_CONFIG_PATH, oxlint: OXLINT_CONFIG_PATH };

/** Names each file `--check` found an own-line block comment in. */
function reportComments(found: readonly OwnLine[], stderr: (s: string) => void): void {
  for (const { file, line } of found) stderr(`repo fmt: ${file} ${OWN_LINE_MESSAGE} ${line}; ${FIX_HINT}\n`);
}

/**
 * `repo fmt`'s conversion of own-line block comments in json, its sort of json keys, then the formatter: the json
 * files under the paths given (all, with none) have their keys sorted, or under `--check` only named on stderr, and
 * the tool then runs on `args` as it was given. A tree with a key out of order fails the check even when the tool
 * passes.
 */
async function formatSorted(job: {
  root: string;
  cwd: string;
  args: string[];
  stderr: (s: string) => void;
  run: RunTool;
}): Promise<number> {
  const { root, cwd, args, stderr, run } = job;

  const paths = args
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => path.relative(root, path.resolve(cwd, arg)).split(path.sep).join("/"));

  const scope = paths.length === 0 ? null : paths;
  const listed = repoJson(root, scope);
  const check = args.includes(CHECK_FLAG);
  const commented = convertJsonc(root, listed.files, { check });

  if (check) reportComments(commented, stderr);
  const sorted = sortJson(root, listed.files, { check });

  if (!sorted.ok) {
    stderr(`repo fmt: ${sorted.error}\n`);

    return 1;
  }

  if (check) {
    for (const { file, key } of sorted.found)
      stderr(`repo fmt: ${file} has keys out of order, first "${key}"; ${FIX_HINT}\n`);
  }

  const code = await run("bun fmt", args, root);

  return code === 0 && (sorted.found.length > 0 || commented.length > 0) && check ? 1 : code;
}

/** Writes `s` to this process's stderr. */
function writeStderr(s: string): void {
  process.stderr.write(s);
}

/**
 * `repo lint` and `repo fmt`: the pinned tool, run in the repo root with the arguments given, once the config
 * loads with the standards pack on and sync has written the tool's config. Its exit code is returned as is, except
 * that `repo fmt --check` also fails on a json key out of order. `repo fmt` in a repo with a root Cargo.toml then runs
 * `cargo fmt --all` (with `--check` when given), and fails on its exit code when bun fmt passed.
 */
export async function runTool(tool: Tool, args: string[], deps: ToolDeps = {}): Promise<number> {
  const { cwd = process.cwd(), stderr = writeStderr, run = spawnTool } = deps;

  function fail(lines: string[]): number {
    for (const line of lines) stderr(`repo ${COMMAND[tool]}: ${line}\n`);

    return 1;
  }

  const root = findRoot(cwd);

  if (root === null) return fail([missingConfig(cwd)]);
  const loaded = await loadConfig(root);

  if (!loaded.ok) return fail(loaded.errors);

  if (!loaded.config.packs.includes("standards"))
    return fail([`the standards pack is off; add "standards" to packs in ${CONFIG_FILE}`]);

  if (!fs.existsSync(path.join(root, CONFIG[tool])))
    return fail([`no ${CONFIG[tool]}; run \`bun repo sync\` to write it`]);

  if (tool !== "bun fmt") return run(tool, args, root);

  return withCargoFmt(root, await formatSorted({ args, cwd, root, run, stderr }), { ...deps, args, stderr });
}

/**
 * `code`, the exit of bun fmt, folded with that of `cargo fmt --all` when `root` has a Cargo.toml: the first
 * failure.
 */
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

export function lint(argv: string[]): Promise<number> {
  return runTool("oxlint", argv);
}

/** `repo fmt`: bun fmt through `runTool`, refusing `--init`, which would write a `[fmt]` section sync then reverts. */
export function fmt(argv: string[], deps: ToolDeps = {}): Promise<number> {
  if (!argv.includes(INIT_FLAG)) return runTool("bun fmt", argv, deps);
  (deps.stderr ?? writeStderr)(`repo fmt: ${INIT_REFUSAL}\n`);

  return Promise.resolve(1);
}

/** The file a package export resolves to, from this package's install. */
function resolved(specifier: string): string {
  // Bun.resolveSync, not import.meta.resolve: vitest's transform drops the latter, and tests run this in-process.
  return Bun.resolveSync(specifier, import.meta.dirname);
}

/** oxlint's bin script, read from its package.json; it is a node shim, so bun runs it. */
function oxlintBin(): string {
  return packageBin(resolved("oxlint/package.json"), "oxlint");
}

/** What a captured run printed and its exit code. */
export type Captured = { code: number; stdout: string; stderr: string };

/**
 * The node_modules dir holding `@workerstack/repo` for this package at `packageRoot`: the one its scope dir sits in
 * when installed (bunx, a consumer), else the root's own, which a dev checkout fills with a self-link.
 */
export function pluginModules(packageRoot: string): string {
  const modules = path.dirname(path.dirname(packageRoot));

  return path.basename(modules) === MODULES_DIR ? modules : path.join(packageRoot, MODULES_DIR);
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
  const inherited = repoEnv.process.NODE_PATH;

  return {
    NODE_PATH: inherited !== undefined && inherited !== "" ? `${modules}${path.delimiter}${inherited}` : modules,
    OXLINT_TSGOLINT_PATH: resolved(tsgolintSpecifier(process.platform, process.arch)),
  };
}

/** The bun command line and environment that run `tool`: oxlint's bin, or bun's own formatter past any `fmt` script. */
function commandOf(tool: Tool) {
  if (tool === "bun fmt") return { args: [...BUN_FMT_ARGS], env: childEnv() };

  return { args: [oxlintBin()], env: childEnv(oxlintEnv()) };
}

/**
 * Spawns bun on the tool's command line, output straight to the terminal, without blocking: `repo lint` runs its
 * script checks while oxlint works. A tool that cannot start or ends on a signal exits 1.
 */
function spawnTool(tool: Tool, args: string[], root: string): Promise<number> {
  const command = commandOf(tool);

  const child = spawn(process.execPath, [...command.args, ...args], {
    cwd: root,
    env: toolEnv(command.env),
    stdio: "inherit",
  });

  return new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function readUtf8(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** Where `capture` runs a command: its dir, its environment, and the line it fails with when the bin is not found. */
type CaptureOptions = { cwd: string; env: NodeJS.ProcessEnv; missing?: string };

/**
 * Runs `bin` with `args` in `cwd`, its output captured instead of printed, with no `GIT_*` variable (`toolEnv`); a
 * `bin` not on PATH fails with the `missing` line. The output goes to files, not pipes: a node script that exits right
 * after writing (oxlint's json report) loses what a pipe had not yet taken.
 */
export function capture(bin: string, args: string[], options: CaptureOptions): Captured {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-capture-"));
  const files = { stderr: path.join(dir, "stderr"), stdout: path.join(dir, "stdout") };
  const out = fs.openSync(files.stdout, "w");
  const err = fs.openSync(files.stderr, "w");
  const { cwd, env, missing } = options;

  try {
    const result = spawnSync(bin, args, { cwd, env: toolEnv(env), stdio: ["ignore", out, err] });

    if (missing !== undefined && isMissing(result.error)) return { code: 1, stderr: `${missing}\n`, stdout: "" };

    return { code: result.status ?? 1, stderr: readUtf8(files.stderr), stdout: readUtf8(files.stdout) };
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
    removeTree(dir);
  }
}

/** Whether a spawn failed because its bin is not on PATH. */
function isMissing(error: Error | undefined): boolean {
  return error !== undefined && "code" in error && error.code === NOT_FOUND;
}

/** Runs bun with `args` in `cwd` as `capture` does. */
export function captureBun(args: string[], cwd: string, env: NodeJS.ProcessEnv = childEnv()): Captured {
  return capture(process.execPath, args, { cwd, env });
}

/** The tool run as `repo lint` or `repo fmt` runs it, in `root`, its output captured instead of printed. */
export function captureTool(tool: Tool, args: string[], root: string): Captured {
  const command = commandOf(tool);

  return captureBun([...command.args, ...args], root, command.env);
}

/**
 * The comment conversion, the sort of json keys, then bun fmt, on `files` as `repo turn` runs them; a refusal to sort
 * fails.
 */
export function captureSorted(files: readonly string[], root: string): Captured {
  convertJsonc(root, files, { check: false });
  const sorted = sortJson(root, files, { check: false });

  if (!sorted.ok) return { code: 1, stderr: `repo turn: ${sorted.error}\n`, stdout: "" };

  return captureTool("bun fmt", ["--no-error-on-unmatched-pattern", ...files], root);
}
