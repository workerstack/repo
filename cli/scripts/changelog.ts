#!/usr/bin/env bun
/** Changelog: print the `## [Unreleased]` section of a package's CHANGELOG.md, or add one entry to it. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseChangelog, trimBlank, unreleasedHasText } from "../release/changelog-parse.ts";
import { fileMissing, insertEntry, noUnreleased } from "../release/changelog.ts";
import { CHANGELOG_FILE, SECTIONS, UNRELEASED } from "../release/release.constants.ts";
import { ownerLookup } from "../tdd-scope.ts";
import {
  ADD_VERB,
  BAD_SECTION,
  CHANGED,
  CRLF,
  DIR_FLAG,
  emptyUnreleased,
  EXIT_REFUSED,
  EXIT_USAGE,
  FLAG_WIDTH,
  LINE_BREAK,
  LINE_END,
  NO_OWNER,
  NOT_FOUND,
  ONE_LINE,
  OUTSIDE,
  RENAMED,
  ROOT_DIR,
  spans,
  STAGED,
  STATUS_CODE_WIDTH,
  STATUS_PATH_AT,
  USAGE,
} from "./changelog.constants.ts";
import { Refusal } from "./refusal.ts";
import { resolveRoots, type Roots } from "./workspace-root.ts";

/** An entry to add: the `###` group and the one line of text. */
type Add = { section: string; entry: string };

/** A request: the package dir `--dir` names (null for none) and the entry to add (null to print). */
type Request = { dir: string | null; add: Add | null };

/** The package whose changelog a request is about, and whether its files were staged. */
type Target = { dir: string; staged: boolean };

/** A changelog being worked on: where it is, how it reads and whether the target came from the staged files. */
type Work = { checkout: string; file: string; raw: string; staged: boolean };

function write(msg: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${msg}\n`);
}

/** The `--dir` as a dir under the checkout. */
function dirOf(checkout: string, dir: string): string {
  const rel = path.relative(checkout, path.resolve(checkout, dir)).replaceAll(path.sep, "/");

  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Refusal(OUTSIDE, EXIT_USAGE);

  return rel === "" ? ROOT_DIR : rel;
}

/** The entry an `add` carries, or null for no verb; throws the usage error of anything else. */
function parseAdd(rest: readonly string[]): Add | null {
  const [verb, section = "", ...words] = rest;
  const entry = words.join(" ").trim();

  if (verb === undefined) return null;

  if (verb !== ADD_VERB || entry === "") throw new Refusal(USAGE, EXIT_USAGE);

  if (!SECTIONS.includes(section)) throw new Refusal(BAD_SECTION, EXIT_USAGE);

  if (LINE_BREAK.test(entry)) throw new Refusal(ONE_LINE, EXIT_USAGE);

  return { entry, section };
}

/** What the arguments ask for; throws the usage error they hold. */
function parseArgs(argv: readonly string[], checkout: string): Request {
  const at = argv.indexOf(DIR_FLAG);
  const value = at === NOT_FOUND ? undefined : argv[at + 1];
  const rest = at === NOT_FOUND ? [...argv] : argv.toSpliced(at, FLAG_WIDTH);

  if ((at !== NOT_FOUND && value === undefined) || rest.includes(DIR_FLAG)) throw new Refusal(USAGE, EXIT_USAGE);
  const toAdd = parseAdd(rest);

  return { add: toAdd, dir: value === undefined ? null : dirOf(checkout, value) };
}

function git(checkout: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function stagedFiles(checkout: string): string[] {
  return git(checkout, "diff", "--cached", "--name-only", "-z")
    .split("\0")
    .filter((file) => file !== "");
}

/** The paths `git status` lists, a rename by its new path; works with no commit yet. */
function changedFiles(checkout: string): string[] {
  const entries = git(checkout, "status", "--porcelain", "-z", "--untracked-files=all")
    .split("\0")
    .filter((entry) => entry !== "");

  const files: string[] = [];
  let isOldPath = false;

  for (const entry of entries) {
    if (!isOldPath) files.push(entry.slice(STATUS_PATH_AT));
    isOldPath = !isOldPath && RENAMED.test(entry.slice(0, STATUS_CODE_WIDTH));
  }

  return files;
}

/** The sorted dirs of the public packages that own `files`, the CHANGELOG.md files left out. */
function ownerDirs(checkout: string, files: readonly string[]): string[] {
  const owner = ownerLookup(checkout);

  const dirs = files
    .filter((file) => path.basename(file) !== CHANGELOG_FILE)
    .map(owner)
    .filter(({ public: isPublic }) => isPublic)
    .map(({ dir }) => dir);

  return [...new Set(dirs)].toSorted();
}

/** The package the staged files belong to, else the changed ones; throws the refusal when there is none or many. */
function ownerOf(checkout: string): Target {
  const sources: [string, () => string[]][] = [
    [STAGED, () => stagedFiles(checkout)],
    [CHANGED, () => changedFiles(checkout)],
  ];

  for (const [name, files] of sources) {
    const dirs = ownerDirs(checkout, files());
    const [dir] = dirs;

    if (dirs.length > 1) throw new Refusal(spans(name, dirs));

    if (dir !== undefined) return { dir, staged: name === STAGED };
  }

  throw new Refusal(NO_OWNER);
}

function fileOf(dir: string): string {
  return dir === ROOT_DIR ? CHANGELOG_FILE : `${dir}/${CHANGELOG_FILE}`;
}

/** The changelog of the target as it reads on disk; throws the refusal when the file is missing. */
function load(checkout: string, { dir, staged }: Target): Work {
  const file = fileOf(dir);
  const abs = path.join(checkout, file);

  if (!fs.existsSync(abs)) throw new Refusal(fileMissing(file));

  return { checkout, file, raw: fs.readFileSync(abs, "utf8"), staged };
}

/** Prints the Unreleased section of the changelog, or that it is empty; throws the refusal when it has none. */
function show({ file, raw }: Work): number {
  const parsed = parseChangelog(raw.replaceAll(CRLF, "\n"));
  const unreleased = parsed.sections.find(({ version }) => version === UNRELEASED);

  if (unreleased === undefined) throw new Refusal(noUnreleased(file));
  const body = trimBlank(unreleased.body).join("\n");

  write(unreleasedHasText(parsed) ? `## [${UNRELEASED}]\n\n${body}` : emptyUnreleased(file));

  return 0;
}

/** Writes the entry into the changelog and prints its line; stages the file when its owner came from staged ones. */
function add({ section, entry }: Add, { checkout, file, raw, staged }: Work): number {
  const added = insertEntry(raw, section, entry);

  if (added === null) throw new Refusal(noUnreleased(file));

  fs.writeFileSync(path.join(checkout, file), added.text);
  write(`${file}:${added.line}  ${added.text.split(LINE_END)[added.line - 1]}`);

  if (staged) {
    git(checkout, "add", "--", file);
    write(`staged ${file}`);
  }

  return 0;
}

/** The package a request is about: `--dir`, else the root to print, else the owner of the staged or changed files. */
function targetOf(request: Request, checkout: string): Target {
  if (request.dir !== null) return { dir: request.dir, staged: false };

  return request.add === null ? { dir: ROOT_DIR, staged: false } : ownerOf(checkout);
}

function run(argv: string[], checkout: string): number {
  const request = parseArgs(argv, checkout);
  const work = load(checkout, targetOf(request, checkout));

  return request.add === null ? show(work) : add(request.add, work);
}

export function main(argv: string[], roots: () => Roots = resolveRoots): number {
  try {
    return run(argv, roots().checkout);
  } catch (err) {
    write((err /* fs, git and the roots lookup throw Errors */ as Error).message, process.stderr);

    return err instanceof Refusal ? err.code : EXIT_REFUSED;
  }
}
