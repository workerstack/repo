/**
 * `repo bench <name> [--remote]`: loads `.repo/bench/<name>.bench.ts`, runs and scores its candidates on this machine,
 * prints the table and writes the raw result under `.repo/tmp/bench/<name>/<os label>.json`. Exits 0 when every run
 * passed, 1 when a candidate failed, 4 on a bad argument or spec. `--remote` also dispatches bench.yml at HEAD for the
 * spec's other OSes, waits on it and prints one table per OS; 1 when that run failed, 4 when a precondition is not met.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { LINE_BREAK, LOCAL_LABELS, NAME } from "../bench/bench.constants.ts";
import { rssFloorOf, spawnBun, type Spawn } from "../bench/measure.ts";
import { parseSpec, type Spec } from "../bench/parse-spec.ts";
import { remoteTarget, runRemote } from "../bench/remote.ts";
import { runSpec } from "../bench/run.ts";
import { renderTable, type BenchResult, type Env, type Machine } from "../bench/score.ts";
import type { ConfigModule } from "../import-config.ts";
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  GIT_HEAD,
  GIT_STATUS,
  JSON_INDENT,
  PREFIX,
  RAW_DIR,
  REMOTE_FLAG,
  SPEC_DIR,
  SPEC_SUFFIX,
  USAGE,
} from "./bench.constants.ts";
import { realSleep, spawnRunner, type Runner } from "./ci-wait-run.ts";

/** Where `repo bench` runs, what it prints to, and each process, clock and machine it reads; real ones by default. */
export type BenchDeps = {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Milliseconds; a run's wall time is the difference around it. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  machine?: () => Machine;
  git?: Runner;
  gh?: Runner;
  spawn?: Spawn;
};

type Io = Required<BenchDeps>;

/** This machine: platform, arch, first CPU's model and core count, memory, Bun version and, on Linux, own peak RSS. */
export function realMachine(): Machine {
  const cpus = os.cpus();

  const cpu = cpus
    .slice(0, 1)
    .map((core) => core.model.trim())
    .join("");

  const { arch, platform } = process;
  const rssFloorBytes = rssFloorOf(platform, () => fs.readFileSync("/proc/self/status", "utf8"));

  return { arch, bun: Bun.version, cores: cpus.length, cpu, memoryBytes: os.totalmem(), platform, rssFloorBytes };
}

/** The real deps: this directory, git and gh, the high-resolution clock, this machine and Bun's runner. */
function realIo(): Io {
  return {
    cwd: process.cwd(),
    gh: spawnRunner("gh"),
    git: spawnRunner("git"),
    machine: realMachine,
    now: performance.now.bind(performance),
    sleep: realSleep,
    spawn: spawnBun,
    stderr: process.stderr.write.bind(process.stderr),
    stdout: process.stdout.write.bind(process.stdout),
  };
}

/** The spec name and whether `--remote` was given, or null for anything else. */
function parseArgs(argv: readonly string[]): { name: string; remote: boolean } | null {
  const names = argv.filter((arg) => arg !== REMOTE_FLAG);
  const [name] = names;

  if (name === undefined || names.length > 1 || !NAME.test(name)) return null;

  return { name, remote: argv.includes(REMOTE_FLAG) };
}

/** The spec names under `.repo/bench`, sorted, or `none`. */
function haveList(cwd: string) {
  const dir = path.join(cwd, SPEC_DIR);

  const names = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(SPEC_SUFFIX))
        .map((file) => file.slice(0, -SPEC_SUFFIX.length))
    : [];

  return names.length === 0 ? "none" : names.toSorted().join(", ");
}

/** A multi-line error message on one line, so each refusal stays one line. */
function oneLine(message: string) {
  return message
    .split(LINE_BREAK)
    .map((text) => text.trim())
    .filter((text) => text !== "")
    .join(" ");
}

/** The parsed spec at `rel`, or the line saying why it cannot be run. */
async function loadSpec(cwd: string, rel: string): Promise<Spec | string> {
  const file = path.join(cwd, rel);

  if (!fs.existsSync(file)) return `${rel} not found; have: ${haveList(cwd)}`;

  try {
    const url = pathToFileURL(file).href;
    const loaded = (await import(url)) /* an import resolves to its module namespace object */ as ConfigModule;
    const parsed = parseSpec(loaded.default);

    return parsed.ok ? parsed.spec : parsed.errors.map((error) => `${rel}: ${error}`).join(`\n${PREFIX}`);
  } catch (error) {
    return `${rel}: ${oneLine(String(error))}`;
  }
}

/** The os label a machine measures under; one no runner has is `<platform>-<arch>`. */
function labelOf(machine: Machine) {
  return LOCAL_LABELS[`${machine.platform} ${machine.arch}`] ?? `${machine.platform}-${machine.arch}`;
}

/** This machine with its os label, and HEAD's sha and whether the tree has changes. */
function localEnv(io: Io): Env {
  const machine = io.machine();
  const label = labelOf(machine);
  const sha = io.git([...GIT_HEAD], io.cwd).stdout.trim();
  const isDirty = io.git([...GIT_STATUS], io.cwd).stdout.trim() !== "";

  return { ...machine, dirty: isDirty, label, sha };
}

/** Writes `result` as the raw JSON of its spec and os label and returns its path relative to the root. */
function writeRaw(cwd: string, result: BenchResult) {
  const rel = `${RAW_DIR}/${result.spec}/${result.env.label}.json`;
  const file = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, JSON_INDENT)}\n`);

  return rel;
}

/** Runs `spec` here, prints its table and raw path, and returns the exit code. */
function runLocal(io: Io, name: string, spec: Spec): number {
  const outcome = runSpec(spec, io);

  if (!outcome.ok) {
    io.stderr(`${PREFIX}${outcome.line}\n`);

    return EXIT_FAILED;
  }

  const { candidates } = outcome;
  const { metrics, runs, warmup } = spec;
  const result = { candidates, env: localEnv(io), metrics, runs, spec: name, warmup };
  const rel = writeRaw(io.cwd, result);
  io.stdout(`${renderTable(result)}raw: ${rel}\n`);

  return EXIT_OK;
}

/** Runs `spec` here when this machine's label is in its os, then on the others in CI, printing a table for each. */
async function runEverywhere(io: Io, name: string, spec: Spec): Promise<number> {
  const label = labelOf(io.machine());
  const remoteIo = { ...io, say: (line: string) => io.stdout(`${PREFIX}${line}\n`) };

  const target = remoteTarget(
    remoteIo,
    name,
    spec.os.filter((runner) => runner !== label),
  );

  if (typeof target === "string") {
    io.stderr(`${PREFIX}${target}\n`);

    return EXIT_USAGE;
  }

  const local = spec.os.length > target.os.length ? runLocal(io, name, spec) : EXIT_OK;

  if (local !== EXIT_OK) return local;
  const remote = await runRemote(remoteIo, target);

  if (!remote.ok) {
    io.stderr(`${PREFIX}${remote.line}\n`);

    return EXIT_FAILED;
  }

  for (const result of remote.results) io.stdout(`${renderTable(result)}raw: ${writeRaw(io.cwd, result)}\n`);

  return EXIT_OK;
}

export async function main(argv: string[], deps?: BenchDeps): Promise<number> {
  const io: Io = { ...realIo(), ...deps };
  const args = parseArgs(argv);

  if (args === null) {
    io.stderr(`${PREFIX}${USAGE}\n`);

    return EXIT_USAGE;
  }

  const spec = await loadSpec(io.cwd, `${SPEC_DIR}/${args.name}${SPEC_SUFFIX}`);

  if (typeof spec === "string") {
    io.stderr(`${PREFIX}${spec}\n`);

    return EXIT_USAGE;
  }

  return args.remote ? runEverywhere(io, args.name, spec) : runLocal(io, args.name, spec);
}
