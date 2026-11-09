/**
 * The ratchets `repo check` holds against main: coverage floors only rise (a rename carries its floor), the
 * known-failures list only shrinks, and a lint rule's baseline total never rises for a rule main already baselines.
 * Main's copies are read from git; no main ref, or a file absent on main, means nothing to compare.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  COMMON_BRANCHES,
  DEFAULT_FLOORS,
  DETACHED,
  NEWLINE,
  ORIGIN,
  RENAME,
  RENAME_COLUMNS,
  TAB,
} from "./check-ratchets.constants.ts";
import { DEFAULT_LIST } from "./known-failures.constants.ts";
import { childEnv } from "./env.ts";
import { toolEnv } from "./scripts/lint.ts";
import { BASELINE_PATH } from "./scripts/lint-baseline.ts";
import { defaultBranch } from "./scripts/worktree.ts";

/** Where the ratcheted files live, as the config's `coverage` section names them. */
export type RatchetPaths = { floors?: string; knownFailures?: string };

type Table = Record<string, Record<string, number>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** git's stdout, or null when it failed; run without any `GIT_*` variable a hook set. */
function git(root: string, args: string[]): string | null {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", env: toolEnv(childEnv()) });
  return run.status === 0 ? run.stdout : null;
}

const hasRef = (root: string, ref: string) =>
  git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;

/** The branches a clone without a local main may still have as `origin/<name>`. */
function originNames(root: string): string[] {
  const head = git(root, ["symbolic-ref", "--short", `refs/remotes/${ORIGIN}/HEAD`]);
  return [head?.trim().replace(`${ORIGIN}/`, "") ?? "", ...COMMON_BRANCHES].filter(Boolean);
}

/**
 * Main's ref: the local default branch, else `origin/<name>`. The default branch falling back to the current branch
 * (or HEAD) is no main, since that compares a branch with itself.
 */
export function mainRef(root: string): string | null {
  const name = defaultBranch(root);
  const current = git(root, ["symbolic-ref", "--short", "HEAD"])?.trim();
  if (name !== DETACHED && name !== current && hasRef(root, name)) return name;
  const remote = [name, ...originNames(root)].map((n) => `${ORIGIN}/${n}`);
  return remote.find((ref) => hasRef(root, ref)) ?? null;
}

function parse(text: string | null): unknown {
  try {
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

const readMain = (root: string, ref: string, rel: string): unknown => parse(git(root, ["show", `${ref}:${rel}`]));
const readHere = (root: string, rel: string): unknown => {
  const file = path.join(root, rel);
  return parse(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
};

function asTable(value: unknown): Table | undefined {
  if (!isRecord(value)) return undefined;
  const table: Table = {};
  for (const [key, row] of Object.entries(value)) {
    if (!isRecord(row)) continue;
    table[key] = Object.fromEntries(Object.entries(row).filter((e): e is [string, number] => typeof e[1] === "number"));
  }
  return table;
}

const asList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

/** Old path → new path of the renames between main and the working tree. */
function renames(root: string, ref: string): Map<string, string> {
  // A failed diff reads as the text "null", which holds no rename.
  const out = String(git(root, ["diff", "-M", "--name-status", ref]));
  const pairs = out
    .split(NEWLINE)
    .map((line) => line.split(TAB))
    .filter(
      (cols): cols is [string, string, string] =>
        cols.length === RENAME_COLUMNS && cols[0]?.startsWith(RENAME) === true,
    );
  return new Map(pairs.map(([, from, to]) => [from, to]));
}

/** One main file's floors against the checkout's, `rel` being its key on main and `key` its key here. */
type Row = { rel: string; key: string; file: string };

function fileFloors({ rel, key, file }: Row, was: Record<string, number>, now: Record<string, number>): string[] {
  const note = key === rel ? "" : ` (renamed from ${rel})`;
  return Object.entries(was).flatMap(([metric, floor]) => {
    const has = now[metric];
    if (has === undefined) return [`${file}: ${key} ${metric} has no floor but main has ${floor}${note}; restore it`];
    return has < floor ? [`${file}: ${key} ${metric} ${has} is below main's ${floor}${note}; floors only rise`] : [];
  });
}

function floorProblems(root: string, ref: string, file: string): string[] {
  const was = asTable(readMain(root, ref, file));
  if (was === undefined) return [];
  const now = asTable(readHere(root, file)) ?? {};
  const moved = renames(root, ref);
  return Object.entries(was).flatMap(([rel, metrics]) => {
    const key = rel in now ? rel : (moved.get(rel) ?? rel);
    const row = now[key];
    if (row !== undefined) return fileFloors({ rel, key, file }, metrics, row);
    return fs.existsSync(path.join(root, key))
      ? [`${file}: ${key} has no floor but main has one and the file exists; restore it`]
      : [];
  });
}

function listProblems(root: string, ref: string, file: string): string[] {
  const was = asList(readMain(root, ref, file));
  if (was === undefined) return [];
  const now = asList(readHere(root, file)) ?? [];
  return now
    .filter((entry) => !was.includes(entry))
    .map((entry) => `${file}: "${entry}" is not on main's list; fix the case instead of listing it`);
}

/** Per rule, the count summed over every file. */
function totals(table: Table): Map<string, number> {
  const sums = new Map<string, number>();
  for (const row of Object.values(table)) {
    for (const [rule, count] of Object.entries(row)) sums.set(rule, (sums.get(rule) ?? 0) + count);
  }
  return sums;
}

function baselineProblems(root: string, ref: string): string[] {
  const was = asTable(readMain(root, ref, BASELINE_PATH));
  if (was === undefined) return [];
  const now = totals(asTable(readHere(root, BASELINE_PATH)) ?? {});
  return [...totals(was)].flatMap(([rule, before]) => {
    const after = now.get(rule) ?? 0;
    return after > before
      ? [`${BASELINE_PATH}: ${rule} totals ${after}, main has ${before}; fix the new hit instead of baselining it`]
      : [];
  });
}

/**
 * Every way the checkout at `root` loosens a ratchet main holds: a lowered or dropped coverage floor, a known-failure
 * entry main's list lacks, a lint rule total above main's. The paths default to `coverage-floors.json` and
 * `known-failures.json`.
 */
export function ratchetProblems(root: string, paths: RatchetPaths = {}): string[] {
  const ref = mainRef(root);
  if (ref === null) return [];
  return [
    ...floorProblems(root, ref, paths.floors ?? DEFAULT_FLOORS),
    ...listProblems(root, ref, paths.knownFailures ?? DEFAULT_LIST),
    ...baselineProblems(root, ref),
  ];
}
