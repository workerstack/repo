/**
 * `repo ci`: every gate of the repo in one call, in order and all of them: `repo check`, `repo fmt --check`,
 * `tsc --noEmit -p` on every tsconfig of the root and each workspace package, and `vitest run --coverage`. Each gate
 * prints its line when it ends, with its output under it when it failed, then one summary line; exit 1 when any failed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, findRoot } from "../config.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { REPORT_JSON_FILE, REPORT_OUTPUT_FLAG, REPORT_REPORTERS, REPORT_TEMP_PREFIX } from "./ci-skips.constants.ts";
import { skipsMain, writeReport } from "./ci-skips.ts";
import { waitMain, type WaitDeps } from "./ci-wait.ts";
import {
  MS_PER_SECOND,
  REPORT_FLAG,
  SKIPPED_SEGMENTS,
  SKIPS_COMMAND,
  SUMMARY_SEPARATOR,
  TSCONFIG_FILE,
  TSC_ARGS,
  USAGE,
  VITEST_RUN_ARGS,
  WAIT_COMMAND,
} from "./ci.constants.ts";
import { captureBun, type Captured } from "./lint.ts";
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
} & Pick<WaitDeps, "git" | "gh" | "sleep">;
/** Where `repo ci` runs and writes. */
type Io = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };
type Ctx = Required<Pick<CiDeps, "bins" | "repo">> & { root: string; json: string | undefined };
type Command =
  | { kind: "gates"; report?: string }
  | { kind: "skips"; dir: string }
  | { kind: "wait" }
  | { kind: "usage" };
/** A gate's outcome; `ran` is false when no tool ran, so there is no time to show. */
type Gate = { label: string; ok: boolean; output: string[]; ran: boolean };

const pass = (label: string, ran = true): Gate => ({ label, ok: true, output: [], ran });
const fail = (label: string, output: string[], ran = true): Gate => ({ label, ok: false, output, ran });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const textOf = (run: Captured) => `${run.stdout}${run.stderr}`;

/** `repo <args>` run by this checkout's bin. */
const runRepo = (args: string[], cwd: string): Captured =>
  captureBun([path.join(import.meta.dirname, "../../bin/repo.ts"), ...args], cwd);

/** `repo <args>` as the gate `name`. */
function repoGate(name: string, args: string[], ctx: Ctx): Gate {
  const run = ctx.repo(args, ctx.root);
  return run.code === 0 ? pass(`${name} ok`) : fail(`${name} failed`, [textOf(run)]);
}

/** The root-relative tsconfigs of the root and each package that is not a fixture or an install. */
function tsconfigs(root: string): { ok: true; files: string[] } | { ok: false; errors: string[] } {
  const workspace = readWorkspace(root);
  if (!workspace.ok) return workspace;
  const dirs = workspace.workspace.packages
    .map((pkg) => pkg.dir)
    .filter((dir) => !dir.split("/").some((segment) => SKIPPED_SEGMENTS.includes(segment)));
  const files = [".", ...dirs].flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && TSCONFIG_FILE.test(entry.name))
      .map((entry) => path.posix.join(dir, entry.name))
      .sort(),
  );
  return { ok: true, files };
}

function typecheckGate(ctx: Ctx): Gate {
  const found = tsconfigs(ctx.root);
  if (!found.ok)
    return fail(
      "typecheck failed",
      found.errors.map((line) => `${line}\n`),
    );
  if (found.files.length === 0) return pass("typecheck skipped (no tsconfig.json)", false);
  const runs = found.files.map((file) => ({ file, run: ctx.bins.tsc([...TSC_ARGS, file], ctx.root) }));
  const bad = runs.filter(({ run }) => run.code !== 0);
  if (bad.length === 0) return pass(`typecheck ${plural(found.files.length, "config")}`);
  return fail(
    `typecheck failed (${bad.map(({ file }) => file).join(", ")})`,
    bad.map(({ run }) => textOf(run)),
  );
}

function testsGate(ctx: Ctx): Gate {
  const reporting = ctx.json === undefined ? [] : [...REPORT_REPORTERS, `${REPORT_OUTPUT_FLAG}${ctx.json}`];
  const run = ctx.bins.vitest([...VITEST_RUN_ARGS, ...reporting], ctx.root);
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
    typecheckGate,
    testsGate,
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

/** What `argv` asks for. */
function parse(argv: string[]): Command {
  const [first, second, ...rest] = argv;
  if (argv.length === 0) return { kind: "gates" };
  if (first === REPORT_FLAG && second !== undefined && rest.length === 0) return { kind: "gates", report: second };
  if (first === SKIPS_COMMAND && second !== undefined && rest.length === 0) return { kind: "skips", dir: second };
  if (first === WAIT_COMMAND && second === undefined) return { kind: "wait" };
  return { kind: "usage" };
}

/** The context to run the gates in, or why `repo ci` cannot start; `json` is where vitest writes its report. */
function prepare(cwd: string, deps: CiDeps, json?: string): { ctx: Ctx } | { error: string } {
  const root = findRoot(cwd);
  if (root === null) return { error: `no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\`` };
  return { ctx: { root, json, bins: deps.bins ?? BINS, repo: deps.repo ?? runRepo } };
}

/** Runs the gates, and writes the skip report to `report` after them when asked for one. */
function gatesMain(report: string | undefined, deps: CiDeps, io: Io): number {
  const temp = report === undefined ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), REPORT_TEMP_PREFIX));
  const json = temp === undefined ? undefined : path.join(temp, REPORT_JSON_FILE);
  try {
    const prepared = prepare(io.cwd, deps, json);
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

export function main(argv: string[], deps: CiDeps = {}): number | Promise<number> {
  const command = parse(argv);
  const io: Io = {
    cwd: deps.cwd ?? process.cwd(),
    stdout: deps.stdout ?? ((s: string) => process.stdout.write(s)),
    stderr: deps.stderr ?? ((s: string) => process.stderr.write(s)),
  };
  if (command.kind === "skips") return skipsMain(command.dir, io);
  if (command.kind === "wait") return waitMain({ ...deps, ...io });
  if (command.kind === "gates") return gatesMain(command.report, deps, io);
  io.stderr(`repo ci: ${USAGE}\n`);
  return 1;
}
