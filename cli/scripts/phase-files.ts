/** `repo phase-files <plan> <phases>`: map a parallel group's unstaged changes to its phases. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parallelFiles, planBoxes, planPhases, type PlanPhase } from "./persist-plan-boxes.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import {
  GIT_MAX_BUFFER,
  LAST,
  MIN_ENTRY_LENGTH,
  MOVE_STATUSES,
  PATH_START,
  PLAN_SERIAL,
  REFUSED_EXIT,
  REQUEST_ARGS,
  SERIAL_ARG,
  USAGE,
} from "./phase-files.constants.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";

/** Why the call is refused, as the line printed. */
type Refusal = { error: string };
/** The phases asked for, and the files each declares. */
type Request = { wanted: PlanPhase[]; declaredBy: Map<string, string[]> };

/** Paths with unstaged or untracked changes, as git prints them; the new side of a rename. */
function unstagedPaths(cwd: string): string[] {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fields = raw.split("\0")[Symbol.iterator]();
  const paths: string[] = [];
  for (const entry of fields) {
    if (entry.length < MIN_ENTRY_LENGTH) continue;
    const x = entry.charAt(0);
    const y = entry.charAt(1);
    // A rename or copy carries its old path in the next field.
    if (MOVE_STATUSES.includes(x) || MOVE_STATUSES.includes(y)) fields.next();
    if (y !== " " || entry.startsWith("??")) paths.push(entry.slice(PATH_START).replaceAll("\\", "/"));
  }
  return [...new Set(paths)].sort();
}

/** The plan at the path `arg` names, labelled by its serial. */
function planAtPath(arg: string, cwd: string): { file: string; label: string } | Refusal {
  const file = path.resolve(cwd, arg);
  if (!fs.existsSync(file)) return { error: `no plan ${arg}\n` };
  return { file, label: path.basename(file).split("-", 1).join("") };
}

/** The newest plan of serial `arg` in the root's plan dir. */
function planBySerial(arg: string, cwd: string): { file: string; label: string } | Refusal {
  const dir = path.join(resolveRoots({}, { cwd, env: {} }).root, PLAN_DIR);
  const serial = Number(arg);
  const names = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((b) => b.endsWith(".md") && Number(PLAN_SERIAL.exec(b)?.[1]) === serial)
    : [];
  const name = names.sort().at(LAST);
  return name === undefined ? { error: `no plan ${arg} in ${dir}\n` } : { file: path.join(dir, name), label: arg };
}

/** The index, for each phase, of the first phase in its run of adjacent parallel phases (one parallel group). */
function groupStarts(phases: readonly PlanPhase[]): (id: string) => number | undefined {
  const starts: number[] = [];
  let start = 0;
  let wasParallel = false;
  for (const [at, phase] of phases.entries()) {
    const isParallel = parallelFiles(phase) !== null;
    if (!isParallel || !wasParallel) start = at;
    starts.push(start);
    wasParallel = isParallel;
  }
  // An id names its first phase.
  return (id) => starts[phases.findIndex((p) => p.id === id)];
}

/** The refusal when `wanted` spans two parallel groups of `phases`, else null. */
function mixedGroups(phases: readonly PlanPhase[], wanted: readonly PlanPhase[]): Refusal | null {
  const startOf = groupStarts(phases);
  const first = wanted[0] /* the ids are never empty, so neither is wanted */ as PlanPhase;
  const other = wanted.find((p) => startOf(p.id) !== startOf(first.id));
  if (other === undefined) return null;
  return { error: `phases ${first.id} and ${other.id} are in different parallel groups; name phases of one group\n` };
}

/** The phases `ids` name, each parallel and all in one group, with the files each declares. */
function wantedPhases(label: string, phases: readonly PlanPhase[], ids: readonly string[]): Request | Refusal {
  const wanted: PlanPhase[] = [];
  for (const id of ids) {
    const phase = phases.find((p) => p.id === id);
    if (phase === undefined) return { error: `plan ${label} has no phase ${id}\n` };
    wanted.push(phase);
  }
  const declaredBy = new Map<string, string[]>();
  for (const p of wanted) {
    const declared = parallelFiles(p);
    if (declared === null) return { error: `phase ${p.id} is not parallel; name phases of one parallel group\n` };
    declaredBy.set(p.id, declared);
  }
  return mixedGroups(phases, wanted) ?? { declaredBy, wanted };
}

/** The request `argv` makes: a plan and a comma-separated list of its parallel phases. */
function parseRequest(argv: readonly string[], cwd: string): Request | Refusal {
  if (argv.length !== REQUEST_ARGS || argv.includes("")) return { error: USAGE };
  const [planArg, phaseArg] = argv /* exactly REQUEST_ARGS arguments, checked above */ as [string, string];
  const plan = SERIAL_ARG.test(planArg) ? planBySerial(planArg, cwd) : planAtPath(planArg, cwd);
  if ("error" in plan) return plan;
  const phases = planPhases(planBoxes(fs.readFileSync(plan.file, "utf8")));
  const ids = [...new Set(phaseArg.split(",").map((s) => s.trim()))].filter((id) => id !== "");
  return ids.length === 0 ? { error: USAGE } : wantedPhases(plan.label, phases, ids);
}

/** The unstaged paths in `cwd`, or why git could not list them. */
function changedPaths(cwd: string): { paths: string[] } | Refusal {
  try {
    return { paths: unstagedPaths(cwd) };
  } catch (e) {
    const { stderr, message } = e /* execFileSync throws an Error carrying the child's stderr */ as Error & {
      stderr?: unknown;
    };
    return { error: `git status failed in ${cwd}: ${String(stderr || message).trim()}\n` };
  }
}

/** Prints each phase's changed files and every unowned one; 1 when any file is unowned. */
function report({ wanted, declaredBy }: Request, changed: readonly string[]): number {
  const owned = new Set<string>();
  for (const [id, declared] of declaredBy) {
    const mine = changed.filter((f) => declared.includes(f));
    for (const f of mine) owned.add(f);
    process.stdout.write(`phase ${id}${mine.map((f) => `  ${f}`).join("")}\n`);
  }
  const unowned = changed.filter((f) => !owned.has(f));
  const ids = wanted.map((p) => p.id).join(",");
  for (const f of unowned)
    process.stderr.write(`unowned  ${f}  (no phase in ${ids} lists it); send it back as a finding\n`);
  return unowned.length > 0 ? 1 : 0;
}

export function main(argv: string[], cwd: string = canonicalPath(process.cwd())): number {
  const request = parseRequest(argv, cwd);
  if ("error" in request) return fail(request.error);
  const changed = changedPaths(cwd);
  if ("error" in changed) return fail(changed.error);
  if (changed.paths.length === 0) {
    process.stdout.write("no unstaged changes\n");
    return 0;
  }
  return report(request, changed.paths);
}

function fail(message: string): number {
  process.stderr.write(message);
  return REFUSED_EXIT;
}
