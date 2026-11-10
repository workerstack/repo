/**
 * `repo ci`: every gate of the repo in one call, in order and all of them: `repo check`, `repo fmt --check`,
 * `tsc --noEmit -p` on every tsconfig of the root and each workspace package, and `vitest run --coverage`. Each gate
 * prints its line when it ends, with its output under it when it failed, then one summary line; exit 1 when any failed.
 * Under the workspace pack the root is typechecked alone and turbo runs each package's typecheck and test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig, type Pack } from "../config.ts";
import { REPORT_JSON_FILE, REPORT_OUTPUT_FLAG, REPORT_REPORTERS, REPORT_TEMP_PREFIX } from "./ci-skips.constants.ts";
import { skipsMain, writeReport } from "./ci-skips.ts";
import { fail, pass, plural, textOf, type Gate } from "./ci-gate.ts";
import { packagesGate, type TurboRun } from "./ci-turbo.ts";
import { typecheckGate } from "./typecheck-gate.ts";
import { waitMain, type WaitDeps } from "./ci-wait.ts";
import {
  MS_PER_SECOND,
  REPORT_FLAG,
  SKIPS_COMMAND,
  SUMMARY_SEPARATOR,
  USAGE,
  NO_COVERAGE_FLAG,
  VITEST_RUN_ARGS,
  VITEST_RUN_NO_COVERAGE_ARGS,
  WAIT_COMMAND,
} from "./ci.constants.ts";
import { captureBun, type Captured } from "./lint.ts";
import { turboRunner } from "./turbo-bin.ts";
import { BINS } from "./turn.ts";
import { countsOfRun, type Bins } from "./turn-steps.ts";

export type CiDeps = {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Milliseconds; the clock the gate times come from. */
  now?: () => number;
  bins?: Bins;
  /** Runs `repo <args>` in a directory. */
  repo?: (args: string[], cwd: string) => Captured;
  /** The packs that are on; read from the config when omitted. */
  packs?: readonly Pack[];
  /** Runs turbo under the workspace pack. */
  turbo?: TurboRun;
} & Pick<WaitDeps, "git" | "gh" | "sleep">;
/** Where `repo ci` runs and writes. */
type Io = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };
type Ctx = Required<Pick<CiDeps, "bins" | "repo" | "turbo">> & {
  root: string;
  json: string | undefined;
  coverage: boolean;
  turboOn: boolean;
};
type Command =
  | { kind: "gates"; report?: string; coverage: boolean }
  | { kind: "skips"; dir: string }
  | { kind: "wait" }
  | { kind: "usage" };
/** `repo <args>` run by this checkout's bin. */
const runRepo = (args: string[], cwd: string): Captured =>
  captureBun([path.join(import.meta.dirname, "../../bin/repo.ts"), ...args], cwd);

/** `repo <args>` as the gate `name`. */
function repoGate(name: string, args: string[], ctx: Ctx): Gate {
  const run = ctx.repo(args, ctx.root);
  return run.code === 0 ? pass(`${name} ok`) : fail(`${name} failed`, [textOf(run)]);
}

function packagesGateOf(ctx: Ctx): Gate {
  return packagesGate({ root: ctx.root, coverage: ctx.coverage, json: ctx.json }, ctx.turbo);
}

function testsGate(ctx: Ctx): Gate {
  const reporting = ctx.json === undefined ? [] : [...REPORT_REPORTERS, `${REPORT_OUTPUT_FLAG}${ctx.json}`];
  const base = ctx.coverage ? VITEST_RUN_ARGS : VITEST_RUN_NO_COVERAGE_ARGS;
  const run = ctx.bins.vitest([...base, ...reporting], ctx.root);
  if (run === null) return pass("tests skipped (no vitest in .)", false);
  const counts = countsOfRun(run);
  if (run.code === 0) return pass(`${plural(counts.passed, "test")} passed`);
  const detail = counts.failed > 0 ? ` (${counts.failed} failed, ${counts.passed} passed)` : "";
  return fail(`tests failed${detail}`, [textOf(run)]);
}

/** Runs each gate in order, printing its line as it ends and its output under it when it failed. */
function runGates(ctx: Ctx, now: () => number, stdout: (s: string) => void): Gate[] {
  const gates: ((ctx: Ctx) => Gate)[] = [
    (c) => repoGate("check", ["check"], c),
    (c) => repoGate("fmt", ["fmt", "--check"], c),
    (c) => typecheckGate(c, c.turboOn),
    ctx.turboOn ? packagesGateOf : testsGate,
  ];
  return gates.map((run) => {
    const started = now();
    const gate = run(ctx);
    const seconds = ((now() - started) / MS_PER_SECOND).toFixed(1);
    stdout(`ci: ${gate.label}${gate.ran ? ` (${seconds}s)` : ""}\n`);
    for (const chunk of gate.output) stdout(chunk.endsWith("\n") ? chunk : `${chunk}\n`);
    return gate;
  });
}

/** The gates run that `--no-coverage` and `--report <file>`, in any order, ask for; null for anything else. */
function gateFlags(argv: string[]): Command | null {
  const command: Command = { kind: "gates", coverage: true };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === NO_COVERAGE_FLAG) command.coverage = false;
    else if (argv[i] === REPORT_FLAG && next !== undefined) {
      command.report = next;
      i++;
    } else return null;
  }
  return command;
}

/** What `argv` asks for. */
function parse(argv: string[]): Command {
  const [first, second, ...rest] = argv;
  if (first === SKIPS_COMMAND && second !== undefined && rest.length === 0) return { kind: "skips", dir: second };
  if (first === WAIT_COMMAND && second === undefined) return { kind: "wait" };
  return gateFlags(argv) ?? { kind: "usage" };
}

/** The context to run the gates in, or why `repo ci` cannot start; `json` is where vitest writes its report. */
function prepare(
  cwd: string,
  deps: CiDeps,
  run: { json: string | undefined; coverage: boolean; turboOn: boolean },
): { ctx: Ctx } | { error: string } {
  const root = findRoot(cwd);
  if (root === null) return { error: `no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\`` };
  const { json, coverage, turboOn } = run;
  const [bins, repo, turbo] = [deps.bins ?? BINS, deps.repo ?? runRepo, deps.turbo ?? turboRunner()];
  return { ctx: { root, json, coverage, turboOn, bins, repo, turbo } };
}

/** Runs the gates, and writes the skip report to `report` after them when asked for one. */
function gatesMain(
  { report, coverage }: { report?: string; coverage: boolean },
  run: { turboOn: boolean; deps: CiDeps },
  io: Io,
): number {
  const { turboOn, deps } = run;
  const temp = report === undefined ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), REPORT_TEMP_PREFIX));
  const json = temp === undefined ? undefined : path.join(temp, REPORT_JSON_FILE);
  try {
    const prepared = prepare(io.cwd, deps, { json, coverage, turboOn });
    if ("error" in prepared) {
      io.stderr(`repo ci: ${prepared.error}\n`);
      return 1;
    }
    const gates = runGates(prepared.ctx, deps.now ?? Date.now, io.stdout);
    io.stdout(`ci: ${gates.map((gate) => gate.label).join(SUMMARY_SEPARATOR)}\n`);
    if (report !== undefined && json !== undefined && !writeTo({ report, json, root: prepared.ctx.root }, io)) return 1;
    return gates.every((gate) => gate.ok) ? 0 : 1;
  } finally {
    if (temp !== undefined) fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** Writes the report file from the JSON at `json`; false, with the reason on stderr, when it cannot be written. */
function writeTo({ report, json, root }: { report: string; json: string; root: string }, io: Io): boolean {
  try {
    writeReport(path.resolve(io.cwd, report), json, root);
    return true;
  } catch (error) {
    io.stderr(
      `repo ci: cannot write ${report}: ${(error /* writeFileSync throws Errors, with a message */ as Error).message}\n`,
    );
    return false;
  }
}

/** Runs the gates once the packs are known: injected, else read from the config. */
function withPacks(command: Extract<Command, { kind: "gates" }>, deps: CiDeps, io: Io): number | Promise<number> {
  if (deps.packs !== undefined) return gatesMain(command, { turboOn: deps.packs.includes("workspace"), deps }, io);
  return packsOf(io.cwd).then((packs) => gatesMain(command, { turboOn: packs.includes("workspace"), deps }, io));
}

/** The packs the config at or above `cwd` turns on; none when there is no config or it is invalid. */
async function packsOf(cwd: string): Promise<readonly Pack[]> {
  const root = findRoot(cwd);
  const loaded = root === null ? null : await loadConfig(root);
  return loaded?.ok ? loaded.config.packs : [];
}

export function main(argv: string[], deps: CiDeps = {}): number | Promise<number> {
  const command = parse(argv);
  const io: Io = {
    cwd: deps.cwd ?? process.cwd(),
    stdout: deps.stdout ?? ((s: string) => process.stdout.write(s)),
    stderr: deps.stderr ?? ((s: string) => process.stderr.write(s)),
  };
  if (command.kind === "skips") return skipsMain(command.dir, io);
  if (command.kind === "wait") return waitMain({ ...deps, ...io });
  if (command.kind === "gates") return withPacks(command, deps, io);
  io.stderr(`repo ci: ${USAGE}\n`);
  return 1;
}
