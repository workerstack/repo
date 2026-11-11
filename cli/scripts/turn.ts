/**
 * `repo turn [--staged] [<path>]`: gates a change set (the working tree, the index, or one package) with fmt, disable
 * comments, lint and its baseline, typecheck, reject files, related tests, and sync and check when their inputs
 * changed, then prints one summary line. Only `--staged` restages, and only what turn itself rewrote.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { findRoot, loadConfig } from "../config.ts";
import { childEnv } from "../env.ts";
import { NESTED_VITEST_FLAGS } from "../nested-vitest-flags.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { changeSet, type Scope } from "./change-set.ts";
import { commentsStep } from "./comments-step.ts";
import { captureBun } from "./lint.ts";
import { rejectionsStep } from "./rejections-step.ts";
import {
  checkStep,
  fmtStep,
  lintStep,
  syncStep,
  testsStep,
  type Bins,
  type Step,
  type StepResult,
  type Turn,
} from "./turn-steps.ts";
import { typecheckStep } from "./typecheck-step.ts";

export type TurnDeps = { cwd?: string; stdout?: (s: string) => void; stderr?: (s: string) => void; bins?: Bins };
type Parsed = { ok: true; scope: Scope } | { ok: false; errors: string[] };

const STEPS: readonly Step[] = [
  fmtStep,
  commentsStep,
  lintStep,
  typecheckStep,
  rejectionsStep,
  testsStep,
  syncStep,
  checkStep,
];
const USE = "use repo turn [--staged] [<path>]";

/** The bin of `name` in the package.json `manifest` resolves to. */
function binOf(manifest: string, name: string): string {
  const { bin } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin: Record<string, string> };
  return path.join(path.dirname(manifest), bin[name] as string);
}

/** typescript from this package's install; vitest from the package being tested, as its own tests would run. */
export const BINS: Bins = {
  tsc: (args, cwd) =>
    captureBun([binOf(Bun.resolveSync("typescript/package.json", import.meta.dirname), "tsc"), ...args], cwd),
  vitest: (args, cwd) => {
    let manifest: string;
    try {
      manifest = Bun.resolveSync("vitest/package.json", cwd);
    } catch {
      return null;
    }
    return captureBun(
      ["--bun", binOf(manifest, "vitest"), ...NESTED_VITEST_FLAGS, ...args],
      cwd,
      childEnv({ NO_COLOR: "1" }),
    );
  },
};

function parseArgs(argv: readonly string[], cwd: string, root: string): Parsed {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const paths = argv.filter((arg) => !arg.startsWith("-"));
  const unknown = flags.find((flag) => flag !== "--staged");
  if (unknown !== undefined) return { errors: [`unknown flag ${unknown}; ${USE}`], ok: false };
  if (paths.length > 1) return { errors: [`one path at most; ${USE}`], ok: false };
  if (flags.length > 0 && paths.length > 0)
    return { errors: ["--staged gates the index, a path gates a package; pass one"], ok: false };
  if (flags.length > 0) return { ok: true, scope: { kind: "staged" } };
  if (paths[0] === undefined) return { ok: true, scope: { kind: "tree" } };
  const rel = path.relative(root, path.resolve(cwd, paths[0])).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { errors: [`${paths[0]} is outside ${root}`], ok: false };
  return { ok: true, scope: { kind: "package", rel } };
}

/** The root, its packages and the change set, or why turn cannot start. */
async function prepare(
  argv: readonly string[],
  cwd: string,
  bins: Bins,
): Promise<{ ok: true; turn: Turn; staged: boolean } | { ok: false; errors: string[] }> {
  const root = findRoot(cwd);
  if (root === null) return { errors: [`no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\``], ok: false };
  const parsed = parseArgs(argv, cwd, root);
  if (!parsed.ok) return parsed;
  const loaded = await loadConfig(root);
  if (!loaded.ok) return loaded;
  if (!loaded.config.packs.includes("standards"))
    return { errors: [`the standards pack is off; add "standards" to packs in ${CONFIG_FILE}`], ok: false };
  const workspace = readWorkspace(root);
  if (!workspace.ok) return workspace;
  const packages = workspace.workspace.packages.map((pkg) => pkg.dir);
  const changes = changeSet(root, parsed.scope, packages);
  if (!changes.ok) return changes;
  const turn = { bins, changes: changes.changes, packages, root, skips: loaded.config.lint.skip };
  return { ok: true, staged: parsed.scope.kind === "staged", turn };
}

/**
 * Stages the files turn rewrote, so the commit carries them as turn left them; when git refuses (a held index
 * lock), says so, since the index would otherwise go out with the content turn fixed only on disk.
 */
function restage(root: string, touched: readonly string[], stderr: (s: string) => void): boolean {
  if (touched.length === 0) return true;
  if (spawnSync("git", ["add", "-A", "--", ...touched], { cwd: root }).status === 0) return true;
  stderr(`repo turn: git add failed for ${touched.join(" ")}; stage it yourself and commit again\n`);
  return false;
}

/** Runs every step whose inputs changed, printing a failed step's output as it ends. */
function runSteps(turn: Turn, stderr: (s: string) => void): StepResult[] {
  return STEPS.flatMap((step) => {
    const result = step(turn);
    if (result === null) return [];
    for (const chunk of result.output) stderr(chunk);
    return [result];
  });
}

/** The deps with the process's own for each one left out. */
function withDefaults(deps: TurnDeps): Required<TurnDeps> {
  return {
    bins: deps.bins ?? BINS,
    cwd: deps.cwd ?? process.cwd(),
    stderr: deps.stderr ?? ((s: string) => process.stderr.write(s)),
    stdout: deps.stdout ?? ((s: string) => process.stdout.write(s)),
  };
}

export async function main(argv: string[], deps: TurnDeps = {}): Promise<number> {
  const { cwd, stdout, stderr, bins } = withDefaults(deps);
  const prepared = await prepare(argv, cwd, bins);
  if (!prepared.ok) {
    for (const line of prepared.errors) stderr(`repo turn: ${line}\n`);
    return 1;
  }
  const { turn, staged } = prepared;
  if (turn.changes.length === 0) {
    stdout("turn: no changes\n");
    return 0;
  }
  const results = runSteps(turn, stderr);
  const touched = [...new Set(results.flatMap((result) => result.touched))];
  const restaged = !staged || restage(turn.root, touched, stderr);
  const files = `${turn.changes.length} file${turn.changes.length === 1 ? "" : "s"}`;
  stdout(`turn: ${files} · ${results.map((result) => result.label).join(" · ")}\n`);
  return restaged && results.every((result) => result.ok) ? 0 : 1;
}
