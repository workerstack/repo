import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { findRoot, loadConfig, missingConfig } from "../config.ts";
import { childEnv } from "../env.ts";
import { removeTree } from "../remove-tree.ts";
import { cargoFmt } from "../rust/cargo-fmt.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { CARGO_MANIFEST } from "../rust/rust-hits.constants.ts";
import { OXLINT_CONFIG_PATH } from "../sync/oxlint-config.ts";
import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import { FIX_HINT } from "./json-keys.constants.ts";
import { repoJson, sortJson } from "./json-keys.ts";
import { OWN_LINE_MESSAGE } from "./jsonc-comments.constants.ts";
import { convertJsonc, type OwnLine } from "./jsonc-comments.ts";
import {
  CHECK_FLAG,
  INIT_FLAG,
  INIT_REFUSAL,
  MS_PER_SECOND,
  NOT_FOUND,
  TIMED_OUT,
  TOOL_TIME_LIMIT_MS,
} from "./lint.constants.ts";
import { toolCommand } from "./tool-command.ts";
import { toolEnv } from "./tool-env.ts";

/** The tools the standards pack runs: the pinned oxlint, and the formatter of the bun running this. */
export type Tool = "oxlint" | "bun fmt";

/** Runs `tool` with `args` in `root` and returns its exit code, or a promise of it for a tool still running. */
export type RunTool = (tool: Tool, args: string[], root: string) => number | Promise<number>;

/**
 * `cargo` runs `cargo fmt`; tests hand their own, and `stdout` receives its diff. `limitMs` is how long the spawned
 * tool may run before it is killed (`TOOL_TIME_LIMIT_MS` when not given).
 */
export type ToolDeps = {
  cwd?: string;
  stderr?: (s: string) => void;
  stdout?: (s: string) => void;
  run?: RunTool;
  cargo?: CargoRun;
  limitMs?: number;
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
  const { cwd = process.cwd(), stderr = writeStderr } = deps;
  const run = deps.run ?? spawner(deps.limitMs, stderr);

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

/** What a captured run printed and its exit code. */
export type Captured = { code: number; stdout: string; stderr: string };

/**
 * The runner `runTool` uses when none is injected: `spawnTool` with the limit (`TOOL_TIME_LIMIT_MS` when not given)
 * and the stderr it got.
 */
function spawner(limitMs = TOOL_TIME_LIMIT_MS, stderr: (s: string) => void): RunTool {
  return (tool, args, root) => spawnTool(tool, args, { limitMs, root, stderr });
}

/** The line a tool run killed at its limit of `ms` fails with. */
function stoppedLine(tool: Tool, ms: number): string {
  return `repo ${COMMAND[tool]}: ${tool} ran past its ${ms / MS_PER_SECOND} s limit and was stopped\n`;
}

/**
 * Spawns bun on the tool's command line, output straight to the terminal, without blocking: `repo lint` runs its
 * script checks while oxlint works. A tool that cannot start or ends on a signal exits 1; one still running at the
 * limit is killed (SIGKILL: a hung oxlint waits in futex) and exits 1 with the line that names it.
 */
function spawnTool(
  tool: Tool,
  args: string[],
  at: { root: string; limitMs: number; stderr: (s: string) => void },
): Promise<number> {
  const { root, limitMs, stderr } = at;
  const command = toolCommand(tool);

  const child = spawn(process.execPath, [...command.args, ...args], {
    cwd: root,
    env: toolEnv(command.env),
    stdio: "inherit",
  });

  let isStopped = false;

  const timer = setTimeout(() => {
    isStopped = true;
    child.kill("SIGKILL");
  }, limitMs);

  return new Promise((resolve) => {
    child.on("error", () => {
      clearTimeout(timer);
      resolve(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);

      if (isStopped) stderr(stoppedLine(tool, limitMs));
      resolve(isStopped ? 1 : (code ?? 1));
    });
  });
}

function readUtf8(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * Where `capture` runs a command: its dir, its environment, the line it fails with when the bin is not found, and the
 * time it may take, with the line it fails with when it is killed at that time.
 */
type CaptureOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  missing?: string;
  limit?: { ms: number; line: string };
};

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
  const { cwd, env, missing, limit } = options;
  const killAt = limit === undefined ? {} : { killSignal: "SIGKILL" as const, timeout: limit.ms };

  try {
    const result = spawnSync(bin, args, { cwd, env: toolEnv(env), stdio: ["ignore", out, err], ...killAt });

    if (missing !== undefined && isMissing(result.error)) return { code: 1, stderr: `${missing}\n`, stdout: "" };

    if (limit !== undefined && hasCode(result.error, TIMED_OUT)) return { code: 1, stderr: limit.line, stdout: "" };

    return { code: result.status ?? 1, stderr: readUtf8(files.stderr), stdout: readUtf8(files.stdout) };
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
    removeTree(dir);
  }
}

/** Whether a spawn failed with the error `code`. */
function hasCode(error: Error | undefined, code: string): boolean {
  return error !== undefined && "code" in error && error.code === code;
}

/** Whether a spawn failed because its bin is not on PATH. */
function isMissing(error: Error | undefined): boolean {
  return hasCode(error, NOT_FOUND);
}

/** Runs bun with `args` in `cwd` as `capture` does. */
export function captureBun(args: string[], cwd: string, env: NodeJS.ProcessEnv = childEnv()): Captured {
  return capture(process.execPath, args, { cwd, env });
}

/**
 * The tool run as `repo lint` or `repo fmt` runs it, in `root`, its output captured instead of printed; one still
 * running after `limitMs` is killed and fails with the line that names it.
 */
export function captureTool(tool: Tool, args: string[], at: { root: string; limitMs?: number }): Captured {
  const { root, limitMs = TOOL_TIME_LIMIT_MS } = at;
  const command = toolCommand(tool);
  const limit = { line: stoppedLine(tool, limitMs), ms: limitMs };

  return capture(process.execPath, [...command.args, ...args], { cwd: root, env: command.env, limit });
}

/**
 * The comment conversion, the sort of json keys, then bun fmt, on `files` as `repo turn` runs them; a refusal to sort
 * fails.
 */
export function captureSorted(files: readonly string[], root: string): Captured {
  convertJsonc(root, files, { check: false });
  const sorted = sortJson(root, files, { check: false });

  if (!sorted.ok) return { code: 1, stderr: `repo turn: ${sorted.error}\n`, stdout: "" };

  return captureTool("bun fmt", ["--no-error-on-unmatched-pattern", ...files], { root });
}
