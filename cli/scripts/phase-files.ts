/** `repo phase-files <plan> <phases>`: map a parallel group's unstaged changes to its phases. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parallelFiles, planBoxes, planPhases } from "./persist-plan-boxes.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";

const USAGE = "usage: repo phase-files <plan serial|path> <phases, e.g. 2,3>\n";

/** Paths with unstaged or untracked changes, as git prints them; the new side of a rename. */
function unstagedPaths(cwd: string): string[] {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  });
  const fields = raw.split("\0")[Symbol.iterator]();
  const paths: string[] = [];
  for (let next = fields.next(); !next.done; next = fields.next()) {
    const entry = next.value;
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    // A rename or copy carries its old path in the next field.
    if (x === "R" || x === "C" || y === "R" || y === "C") fields.next();
    if (y !== " " || entry.startsWith("??")) paths.push(entry.slice(3).replace(/\\/g, "/"));
  }
  return [...new Set(paths)].sort();
}

function findPlan(arg: string, cwd: string): { file: string; label: string } | { error: string } {
  if (!/^\d+$/.test(arg)) {
    const file = path.resolve(cwd, arg);
    return fs.existsSync(file)
      ? { file, label: path.basename(file).split("-", 1).join("") }
      : { error: `no plan ${arg}\n` };
  }
  const dir = path.join(resolveRoots({}, { cwd, env: {} }).root, PLAN_DIR);
  const serial = Number(arg);
  const names = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((b) => b.endsWith(".md") && Number(/^(\d+)-/.exec(b)?.[1]) === serial)
    : [];
  const name = names.sort().at(-1);
  return name ? { file: path.join(dir, name), label: arg } : { error: `no plan ${arg} in ${dir}\n` };
}

export function main(argv: string[], cwd: string = canonicalPath(process.cwd())): number {
  const [planArg, phaseArg, ...extra] = argv;
  if (!planArg || !phaseArg || extra.length) return fail(USAGE);
  const plan = findPlan(planArg, cwd);
  if ("error" in plan) return fail(plan.error);

  const phases = planPhases(planBoxes(fs.readFileSync(plan.file, "utf8")));
  const ids = [
    ...new Set(
      phaseArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return fail(USAGE);
  const wanted = [];
  const declaredBy = new Map<string, string[]>();
  for (const id of ids) {
    const phase = phases.find((p) => p.id === id);
    if (!phase) return fail(`plan ${plan.label} has no phase ${id}\n`);
    wanted.push(phase);
  }
  for (const p of wanted) {
    const declared = parallelFiles(p);
    if (!declared) return fail(`phase ${p.id} is not parallel; name phases of one parallel group\n`);
    declaredBy.set(p.id, declared);
  }

  // Adjacent parallel phases are one group.
  const groupOf = (id: string) => {
    const at = phases.findIndex((p) => p.id === id);
    let from = at;
    let to = at;
    while (from > 0 && parallelFiles(phases[from - 1]!)) from--;
    while (to < phases.length - 1 && parallelFiles(phases[to + 1]!)) to++;
    return from;
  };
  const first = wanted[0]!;
  const other = wanted.find((p) => groupOf(p.id) !== groupOf(first.id));
  if (other)
    return fail(`phases ${first.id} and ${other.id} are in different parallel groups; name phases of one group\n`);

  let changed: string[];
  try {
    changed = unstagedPaths(cwd);
  } catch (e) {
    const detail = String((e as { stderr?: unknown }).stderr || (e as Error).message).trim();
    return fail(`git status failed in ${cwd}: ${detail}\n`);
  }
  if (!changed.length) {
    process.stdout.write("no unstaged changes\n");
    return 0;
  }

  const owned = new Set<string>();
  for (const [id, declared] of declaredBy) {
    const mine = changed.filter((f) => declared.includes(f));
    mine.forEach((f) => owned.add(f));
    process.stdout.write(`phase ${id}${mine.map((f) => `  ${f}`).join("")}\n`);
  }
  const unowned = changed.filter((f) => !owned.has(f));
  for (const f of unowned) {
    process.stderr.write(
      `unowned  ${f}  (no phase in ${wanted.map((p) => p.id).join(",")} lists it); send it back as a finding\n`,
    );
  }
  return unowned.length ? 1 : 0;
}

function fail(message: string): number {
  process.stderr.write(message);
  return 2;
}
