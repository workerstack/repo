/**
 * `repo check`'s workflow lines: actionlint, pinned to one release, run over `.github/workflows` under the release
 * pack. The binary is fetched once into the state home, checked against its pinned sha256 and cached; a download that
 * fails or does not match is a problem line, never a cached file.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  ACTIONLINT_FLAGS,
  ACTIONLINT_VERSION,
  ARCH_NAMES,
  BINARY_MODE,
  CACHE_DIR,
  DEFAULT_SYSTEM_ROOT,
  EXIT_PROBLEMS,
  FETCH_TIMEOUT_MS,
  HASHES,
  MAX_OUTPUT_BYTES,
  OS_NAMES,
  RELEASE_URL,
  SHOWN_HASH,
  WINDOWS_PLATFORM,
  WINDOWS_TAR,
  WORKFLOW_EXTENSIONS,
  WORKFLOWS_DIR,
} from "./actionlint.constants.ts";
import { findRoot, loadConfig } from "./config.ts";
import { childEnv } from "./env.ts";
import { type Captured } from "./scripts/lint.ts";
import { stateHome } from "./scripts/setup-files.ts";
import { toolEnv } from "./scripts/tool-env.ts";

/** What `repo check` prints of actionlint: problem lines that fail it. */
export type ActionlintCheck = { problems: string[] };
/** Runs `command` with `args`; the default spawns it and captures its output. */
export type Spawn = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Captured;
/** Everything `checkActionlintAt` reaches outside the repo through, each replaceable by a test. */
export type ActionlintDeps = {
  fetch?: (url: string) => Promise<Uint8Array>;
  spawn?: Spawn;
  cacheDir?: string;
  platform?: string;
  arch?: string;
  hashes?: Record<string, string>;
};
/** The deps with every default filled in. */
type Resolved = ActionlintDeps & Required<Pick<ActionlintDeps, "fetch" | "spawn" | "hashes">>;
type Binary = { ok: true; path: string } | { ok: false; problem: string };
type Bytes = { ok: true; bytes: Uint8Array } | { ok: false; problem: string };
/** What an install needs: the archive's name and key, where the binary goes and the injected edges. */
type Plan = { name: string; key: string; target: string; platform: string; deps: Resolved };

const NONE: ActionlintCheck = { problems: [] };
function itemsSchema() {
  return z.array(
    z.object({ column: z.number(), filepath: z.string(), kind: z.string(), line: z.number(), message: z.string() }),
  );
}

/** The archive at `url`, or a thrown error for a failed request. */
export async function fetchArchive(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export function spawnCaptured(...[command, args, { cwd, env }]: Parameters<Spawn>): ReturnType<Spawn> {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env, maxBuffer: MAX_OUTPUT_BYTES });
  // A command that cannot start leaves stdout and stderr unset at runtime, whatever the types say.
  if (result.error !== undefined) return { code: 1, stderr: `${result.error.message}\n`, stdout: "" };
  return { code: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
}

/** The workflow files under `root`, relative and sorted; none when the directory is missing. */
function workflowsOf(root: string): string[] {
  const dir = path.join(root, WORKFLOWS_DIR);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((name) => WORKFLOW_EXTENSIONS.includes(path.extname(name)));
  return names.toSorted().map((name) => `${WORKFLOWS_DIR}/${name}`);
}

/** The archive's bytes when they hash to the pinned value; otherwise the problem line. */
async function download(plan: Plan): Promise<Bytes> {
  const { name, key, deps } = plan;
  let bytes: Uint8Array;
  try {
    bytes = await deps.fetch(`${RELEASE_URL}/${name}`);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { ok: false, problem: `could not fetch ${ACTIONLINT_VERSION} (${why}); connect once so repo can cache it` };
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  const expected = deps.hashes[key] ?? "";
  if (actual === expected) return { bytes, ok: true };
  const [a, e] = [actual, expected].map((hash) => `${hash.slice(0, SHOWN_HASH)}…`);
  return { ok: false, problem: `${name} has sha256 ${a}, expected ${e}; nothing was cached` };
}

/** Unpacks `archive` into `into` with tar; on windows the system tar by full path, which reads a zip. */
function unpack(plan: Plan, archive: string, into: string): Captured {
  const system = childEnv().SystemRoot ?? DEFAULT_SYSTEM_ROOT;
  const tar = plan.platform === WINDOWS_PLATFORM ? `${system}${WINDOWS_TAR}` : "tar";
  const spawn = plan.deps.spawn;
  return spawn(tar, ["-xf", archive, "-C", into], { cwd: into, env: toolEnv(childEnv()) });
}

/** Fetches, verifies, unpacks and renames the binary into place; a problem line when any step fails. */
async function install(plan: Plan): Promise<Binary> {
  const dir = path.dirname(plan.target);
  const archive = path.join(dir, `download-${process.pid}-${plan.name}`);
  const extracted = path.join(dir, `unpack-${process.pid}`);
  try {
    const got = await download(plan);
    if (!got.ok) return got;
    fs.writeFileSync(archive, got.bytes);
    fs.mkdirSync(extracted, { recursive: true });
    const tarred = unpack(plan, archive, extracted);
    if (tarred.code !== 0) return { ok: false, problem: `could not unpack ${plan.name}: ${tarred.stderr.trim()}` };
    const unpacked = path.join(extracted, path.basename(plan.target));
    fs.chmodSync(unpacked, BINARY_MODE);
    fs.renameSync(unpacked, plan.target);
    return { ok: true, path: plan.target };
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(extracted, { force: true, recursive: true });
  }
}

/** The cached binary, installing it first when it is missing. */
async function binaryFor(deps: Resolved): Promise<Binary> {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const [osName, archName] = [OS_NAMES[platform], ARCH_NAMES[arch]];
  if (osName === undefined || archName === undefined) {
    const build = `${ACTIONLINT_VERSION} build for ${platform} ${arch}`;
    return { ok: false, problem: `no ${build}; run repo check on linux, macOS or Windows` };
  }
  const cacheDir = deps.cacheDir ?? path.join(stateHome(), CACHE_DIR, ACTIONLINT_VERSION);
  const target = path.join(cacheDir, platform === WINDOWS_PLATFORM ? "actionlint.exe" : "actionlint");
  if (fs.existsSync(target)) return { ok: true, path: target };
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = `${osName}_${archName}`;
  const name = `actionlint_${ACTIONLINT_VERSION}_${key}${platform === WINDOWS_PLATFORM ? ".zip" : ".tar.gz"}`;
  return await install({ deps, key, name, platform, target });
}

/** One line per item of actionlint's json, or the failure line when the run or its output is not as expected. */
function linesOf(ran: Captured): string[] {
  if (ran.code === 0) return [];
  const failure = `actionlint: exited ${ran.code}: ${ran.stderr.trim()}`;
  if (ran.code !== EXIT_PROBLEMS) return [failure];
  try {
    const items = itemsSchema().parse(JSON.parse(ran.stdout));
    return items.map((i) => `actionlint: ${i.filepath}:${i.line}:${i.column}: ${i.message} [${i.kind}]`);
  } catch {
    return [failure];
  }
}

/**
 * `repo check`'s actionlint lines for the repo at `cwd`: none without a config, without the release pack or without a
 * workflow file, and then no download either.
 */
export async function checkActionlintAt(cwd: string, deps: ActionlintDeps = {}): Promise<ActionlintCheck> {
  const root = findRoot(cwd);
  if (root === null) return NONE;
  const loaded = await loadConfig(root);
  if (!loaded.ok || !loaded.config.packs.includes("release")) return NONE;
  const files = workflowsOf(root);
  if (files.length === 0) return NONE;
  const io = { fetch: fetchArchive, hashes: HASHES, spawn: spawnCaptured, ...deps };
  const binary = await binaryFor(io);
  if (!binary.ok) return { problems: [`actionlint: ${binary.problem}`] };
  const args = [...ACTIONLINT_FLAGS, ...files];
  const ran = io.spawn(binary.path, args, { cwd: root, env: toolEnv(childEnv()) });
  return { problems: linesOf(ran) };
}
