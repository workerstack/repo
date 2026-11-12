import { spawnSync } from "node:child_process";
/**
 * The ratchets `repo check` holds against main: coverage floors only rise (a rename carries its floor), the
 * known-failures list only shrinks, a mutation floor never drops, and a lint rule's baseline total never rises for a
 * rule main already baselines.
 * Main's copies are read from git; no main ref, or a file absent on main, means nothing to compare.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  COMMON_BRANCHES,
  DEFAULT_FLOORS,
  DEFAULT_MUTATION_FLOORS,
  DETACHED,
  NEWLINE,
  ORIGIN,
  RENAME,
  RENAME_COLUMNS,
  TAB,
} from "./check-ratchets.constants.ts";
import { childEnv } from "./env.ts";
import { isString, tryJson } from "./json.ts";
import { DEFAULT_LIST } from "./known-failures.constants.ts";
import { BASELINE_PATH } from "./scripts/lint-baseline.constants.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { defaultBranch } from "./scripts/worktree-git.ts";

/** Where the ratcheted files live, as the config's `coverage` section names them. */
export type RatchetPaths = { floors?: string; knownFailures?: string; mutationFloors?: string };

type Table = Record<string, Record<string, number>>;

/** git's stdout, or null when it failed; run without any `GIT_*` variable a hook set. */
function git(root: string, args: string[]): string | null {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", env: toolEnv(childEnv()) });

  return run.status === 0 ? run.stdout : null;
}

function hasRef(root: string, ref: string) {
  return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

/** The branches a clone without a local main may still have as `origin/<name>`. */
function originNames(root: string): string[] {
  const head = git(root, ["symbolic-ref", "--short", `refs/remotes/${ORIGIN}/HEAD`]);

  return [head?.trim().replace(`${ORIGIN}/`, "") ?? "", ...COMMON_BRANCHES].filter(Boolean);
}

/**
 * Main's ref: the local default branch, else `origin/<name>`. The default branch falling back to the current branch
 * (or HEAD) is no main, since that compares a branch with itself.
 */
function mainRef(root: string): string | null {
  const name = defaultBranch(root);
  const current = git(root, ["symbolic-ref", "--short", "HEAD"])?.trim();

  if (name !== DETACHED && name !== current && hasRef(root, name)) return name;
  const remote = [name, ...originNames(root)].map((n) => `${ORIGIN}/${n}`);

  return remote.find((ref) => hasRef(root, ref)) ?? null;
}

/** Where a ratcheted file is read on main: the repo, main's ref and the file's root-relative path. */
type OnMain = { root: string; ref: string; rel: string };

/** A JSON object whose entries `value` refuses are dropped: a hand-edited file's odd row or floor reads as absent. */
function keptSchema<T>(value: z.ZodType<T>): z.ZodType<Record<string, T>> {
  return z.record(z.string(), z.unknown()).transform((map) =>
    Object.fromEntries(
      Object.entries(map).flatMap(([key, raw]): [string, T][] => {
        const read = value.safeParse(raw);

        return read.success ? [[key, read.data]] : [];
      }),
    ),
  );
}

function numbersSchema(): z.ZodType<Record<string, number>> {
  return keptSchema(z.number());
}

function tableSchema(): z.ZodType<Table> {
  return keptSchema(numbersSchema());
}

/** A JSON list's strings; its other items are dropped. */
function listSchema(): z.ZodType<string[]> {
  return z.array(z.json()).transform((items) => items.filter(isString));
}

/** `text` read through `schema`; undefined when there is no text, it is no JSON, or `schema` refuses its shape. */
function parse<T>(schema: z.ZodType<T>, text: string | null): T | undefined {
  return text === null ? undefined : tryJson(schema, text);
}

function readMain<T>(schema: z.ZodType<T>, { root, ref, rel }: OnMain): T | undefined {
  return parse(schema, git(root, ["show", `${ref}:${rel}`]));
}

function readHere<T>(schema: z.ZodType<T>, root: string, rel: string): T | undefined {
  const file = path.join(root, rel);

  return parse(schema, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
}

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
  const was = readMain(tableSchema(), { ref, rel: file, root });

  if (was === undefined) return [];
  const now = readHere(tableSchema(), root, file) ?? {};
  const moved = renames(root, ref);

  return Object.entries(was).flatMap(([rel, metrics]) => {
    const key = rel in now ? rel : (moved.get(rel) ?? rel);
    const row = now[key];

    if (row !== undefined) return fileFloors({ file, key, rel }, metrics, row);

    return fs.existsSync(path.join(root, key))
      ? [`${file}: ${key} has no floor but main has one and the file exists; restore it`]
      : [];
  });
}

/** A mutation floor lowered, or dropped while its package dir exists; a package dir that is gone takes its floor. */
function mutationProblems(root: string, ref: string, file: string): string[] {
  const was = readMain(numbersSchema(), { ref, rel: file, root });

  if (was === undefined) return [];
  const now = readHere(numbersSchema(), root, file) ?? {};

  return Object.entries(was).flatMap(([pkg, floor]) => {
    const has = now[pkg];

    if (has === undefined)
      return fs.existsSync(path.join(root, pkg)) ? [`${file} drops ${pkg} from ${floor}; floors only rise`] : [];

    return has < floor ? [`${file} lowers ${pkg} from ${floor} to ${has} against main; floors only rise`] : [];
  });
}

function listProblems(root: string, ref: string, file: string): string[] {
  const was = readMain(listSchema(), { ref, rel: file, root });

  if (was === undefined) return [];
  const now = readHere(listSchema(), root, file) ?? [];

  return now
    .filter((entry) => !was.includes(entry))
    .map((entry) => `${file}: "${entry}" is not on main's list; fix the case instead of listing it`);
}

/** Per rule, the count summed over every file. */
function totals(table: Table): Map<string, number> {
  const sums = new Map<string, number>();

  for (const row of Object.values(table))
    for (const [rule, count] of Object.entries(row)) sums.set(rule, (sums.get(rule) ?? 0) + count);

  return sums;
}

function baselineProblems(root: string, ref: string): string[] {
  const was = readMain(tableSchema(), { ref, rel: BASELINE_PATH, root });

  if (was === undefined) return [];
  const now = totals(readHere(tableSchema(), root, BASELINE_PATH) ?? {});

  return [...totals(was)].flatMap(([rule, before]) => {
    const after = now.get(rule) ?? 0;

    return after > before
      ? [`${BASELINE_PATH}: ${rule} totals ${after}, main has ${before}; fix the new hit instead of baselining it`]
      : [];
  });
}

/**
 * Every way the checkout at `root` loosens a ratchet main holds: a lowered or dropped coverage floor, a known-failure
 * entry main's list lacks, a lowered mutation floor, a lint rule total above main's. The paths default to
 * `coverage-floors.json`, `known-failures.json` and `mutation-floors.json`.
 */
export function ratchetProblems(root: string, paths: RatchetPaths = {}): string[] {
  const ref = mainRef(root);

  if (ref === null) return [];

  return [
    ...floorProblems(root, ref, paths.floors ?? DEFAULT_FLOORS),
    ...listProblems(root, ref, paths.knownFailures ?? DEFAULT_LIST),
    ...mutationProblems(root, ref, paths.mutationFloors ?? DEFAULT_MUTATION_FLOORS),
    ...baselineProblems(root, ref),
  ];
}
