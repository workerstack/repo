#!/usr/bin/env bun
/**
 * Move agent files from `.tmp/repo/<x>` to `.repo/...`. Text mode rewrites the old spellings in source and docs;
 * `--check` lists what is left; `--tree <dir>` moves an on-disk `.tmp/repo` dir into its `.repo` home.
 *
 *   bun dev/move-tmp-paths.ts [paths...]          rewrite (default: cli bin dev e2e agents references
 *                                                 README.md AGENTS.md)
 *   bun dev/move-tmp-paths.ts --check [paths...]  write nothing, exit 1 and print file:line of each leftover
 *   bun dev/move-tmp-paths.ts --tree <dir>        move a `.tmp/repo` tree under `<root>/.repo`
 */
import fs from "node:fs";
import path from "node:path";

import { REPO, SCRATCH, STATE, STATE_DIRS, WORK_DIRS } from "../cli/repo-dirs.ts";
import * as K from "./move-tmp-paths.constants.ts";
import { ARGV_START } from "./move-tmp-paths.constants.ts";
import { processIo } from "./process-io.ts";

type Io = { out: (line: string) => void; err: (line: string) => void };

/** One path segment: a `${...}` template hole or any run of characters that cannot end a path in text. */
function segment(): string {
  return String.raw`(?:\$\{[^}]*\}|[^\s/\\"'\`(),;:<>|*?\[\]{}])+`;
}

function separator(): string {
  return String.raw`(?:\\\\|[\\/])`;
}

/** `.tmp/repo`, optionally followed by a separator and a first segment; not `.tmp/repository`. */
function pathRe(): RegExp {
  return new RegExp(String.raw`\.tmp(${separator()})repo(?![A-Za-z0-9_-])(?:(${separator()})(${segment()})?)?`, "g");
}

/** `".tmp", "repo"` with an optional third quoted segment, in any one quote style. */
function arrayRe(): RegExp {
  return new RegExp(String.raw`(["'\`])\.tmp\1(\s*,\s*|\s+)\1repo\1(?:(\s*,\s*|\s+)\1(${segment()})\1)?`, "g");
}

function leftoverRe(): RegExp {
  return new RegExp(String.raw`\.tmp${separator()}repo(?![A-Za-z0-9_-])`);
}

type MoveCtx = { moved: string[]; io: Io };

type Home = "work" | "state" | "scratch";

/** Where `.tmp/repo/<name>` goes: a work dir at the top of `.repo`, a state dir under `tmp`, else `scratch`. */
function homeOf(name: string): Home {
  if (WORK_DIRS.some((dir) => dir === name)) return "work";

  if (STATE_DIRS.has(name) || name.startsWith(K.RED_PROOF)) return "state";

  return "scratch";
}

/** The `.repo` segments for an entry name; `null` is the `.tmp/repo` dir itself. */
function homeSegments(name: string | null): string[] {
  if (name === null) return [SCRATCH];
  const home = homeOf(name);

  if (home === "work") return [name];

  return home === "state" ? [STATE, name] : [SCRATCH, name];
}

/** Rewrite every old `.tmp/repo` spelling in `text`: paths with either separator and quoted segment arrays. */
export function mapText(text: string): string {
  const paths = text.replaceAll(pathRe(), (...match: (string | undefined)[]) => {
    const [, sep = "/", sep2, name] = match;

    if (sep2 === undefined) return `${REPO}${sep}${SCRATCH}`;

    if (name === undefined) return `${REPO}${sep}${SCRATCH}${sep2}`;

    return [REPO, ...homeSegments(name)].join(sep);
  });

  return paths.replaceAll(arrayRe(), (...match: (string | undefined)[]) => {
    const [, quote = '"', comma = ", ", comma2, name] = match;
    const segments = name === undefined ? [SCRATCH] : homeSegments(name);

    return [REPO, ...segments].map((part) => `${quote}${part}${quote}`).join(comma2 ?? comma);
  });
}

function isLeftover(line: string): boolean {
  return leftoverRe().test(line) || mapText(line) !== line;
}

/** Every file under `entry` (a file or a dir), skipping the fenced names; paths are relative to `root`. */
function filesUnder(root: string, entry: string): string[] {
  const abs = path.resolve(root, entry);

  if (K.SKIPPED.includes(path.basename(abs))) return [];
  const stat = fs.statSync(abs, { throwIfNoEntry: false });

  if (stat === undefined) return [];

  if (stat.isFile()) return [path.relative(root, abs)];

  return fs
    .readdirSync(abs)
    .toSorted()
    .flatMap((name) => filesUnder(root, path.join(abs, name)));
}

/** The text of `rel` under `root`, or null for a binary file. */
function readText(root: string, rel: string): string | null {
  const text = fs.readFileSync(path.join(root, rel), "utf8");

  return text.includes("\0") ? null : text;
}

/** `file:line` for each leftover old spelling under `paths`. */
export function checkLeftovers(root: string, paths: readonly string[]): string[] {
  const found: string[] = [];

  for (const rel of paths.flatMap((entry) => filesUnder(root, entry))) {
    const text = readText(root, rel);

    if (text === null) continue;
    const display = rel.split(path.sep).join("/");

    if (K.SELF.includes(display)) continue;

    for (const [index, line] of text.split("\n").entries()) if (isLeftover(line)) found.push(`${display}:${index + 1}`);
  }

  return found;
}

/** Rewrite the files under `paths`; the count of files changed. */
function rewrite(root: string, paths: readonly string[]): number {
  let changed = 0;

  for (const rel of paths.flatMap((entry) => filesUnder(root, entry))) {
    const text = readText(root, rel);

    if (text === null) continue;
    const next = mapText(text);

    if (next === text) continue;
    fs.writeFileSync(path.join(root, rel), next);
    changed += 1;
  }

  return changed;
}

function moveEntry(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    fs.renameSync(src, dest);
  } catch {
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { force: true, recursive: true });
  }
}

/** Move `src` to `dest`, merging into an existing dir; files that already exist at `dest` stay and are reported. */
function mergeMove(src: string, dest: string, ctx: MoveCtx): void {
  const stat = fs.lstatSync(src);
  const existing = fs.lstatSync(dest, { throwIfNoEntry: false });

  if (existing === undefined) {
    moveEntry(src, dest);
    ctx.moved.push(...filesUnder(dest, ".").map((rel) => path.join(dest, rel)));

    return;
  }

  if (stat.isDirectory() && existing.isDirectory()) {
    for (const name of fs.readdirSync(src)) mergeMove(path.join(src, name), path.join(dest, name), ctx);
    removeIfEmpty(src);

    return;
  }

  ctx.io.err(`conflict: ${src} not moved, ${dest} exists`);
}

function removeIfEmpty(dir: string): void {
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/** Move the entries of an on-disk `.tmp/repo` dir under `<root>/.repo` (root is the dir's grandparent); 0 always. */
export function moveTree(tree: string, io: Io): number {
  const source = path.resolve(tree);

  if (!fs.existsSync(source)) return 0;
  const repo = path.join(path.dirname(path.dirname(source)), REPO);
  const ctx: MoveCtx = { io, moved: [] };

  for (const name of fs.readdirSync(source))
    mergeMove(path.join(source, name), path.join(repo, ...homeSegments(name)), ctx);

  for (const file of ctx.moved) {
    const text = readText("", file);

    if (text === null) continue;
    const next = mapText(text);

    if (next !== text) fs.writeFileSync(file, next);
  }

  removeIfEmpty(source);

  return 0;
}

/** Run the script with `args` from `root`; the exit code. */
export function run(args: readonly string[], io: Io, root: string = process.cwd()): number {
  if (args.includes(K.TREE_FLAG)) {
    const dir = args[args.indexOf(K.TREE_FLAG) + 1];

    if (dir === undefined) {
      io.err(`${K.TREE_FLAG} needs a directory`);

      return 1;
    }

    return moveTree(path.resolve(root, dir), io);
  }

  const check = args.includes(K.CHECK_FLAG);
  const rest = args.filter((arg) => arg !== K.CHECK_FLAG);
  const paths = rest.length > 0 ? rest : K.DEFAULT_PATHS;

  if (check) {
    const left = checkLeftovers(root, paths);

    for (const line of left) io.out(line);

    return left.length > 0 ? 1 : 0;
  }

  io.out(`rewrote ${rewrite(root, paths)} files`);

  return 0;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(ARGV_START), processIo);
