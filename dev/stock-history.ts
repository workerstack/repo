#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sortedJsonValue } from "../cli/scripts/json-keys.ts";
import { byCodeUnit } from "../cli/sync/by-code-unit.ts";
import {
  HOOK_COMMANDS_KEY,
  STOCK_HISTORY_FILE,
  STOCK_PREFIXES,
  hashText,
  hookCommands,
  type StockHistory,
} from "../cli/sync/stock-history.ts";
import { processIo } from "./process-io.ts";
import {
  ARGV_START,
  CAT_FILE_ARGS,
  DEFAULT_REFS,
  FMT_ARGS,
  GIT_ERROR_WORDS,
  GIT_MAX_BUFFER,
  LOG_ARGS,
  LOG_TOKENS_PER_ENTRY,
  LS_FILES_ARGS,
  REGULAR_MODE,
  REPO_BIN,
  SETTINGS,
} from "./stock-history.constants.ts";

/** The space or tab between `git ls-files --stage` fields. */
const FIELD_SEP = /[ \t]/;
const TRAILING_SLASH = /\/$/;

type Io = { out: (line: string) => void; err: (line: string) => void };

/**
 * Writes `cli/sync/stock-history.json`: for every stock path a copied install can hold (`STOCK_PREFIXES`), the hash
 * of every version git history has had on `main` and `HEAD` plus the version in the working tree. The migration
 * reads it to tell an unedited copy of an old stock file from the consumer's own edit. The key
 * `.claude/settings.json#commands` holds the hash of every hook command those settings files ever ran.
 *
 * Rerun it before each release, and after any change to a stock file (`bun dev/stock-history.ts`): a stock file
 * whose current text is missing from the table fails `dev/stock-history.test.ts`. It is deterministic and safe to
 * rerun.
 *
 * `source` picks the current stock files: the working tree (the generator) or the git index (`"index"`, what a commit
 * holds, so a tool that rewrites files in the tree cannot fail the currency test).
 */
export function collectHistory(
  repoRoot: string,
  refs: readonly string[] = DEFAULT_REFS,
  source: CurrentSource = "tree",
): StockHistory {
  const found = new Map<string, Set<string>>();

  function addFile(rel: string, bytes: Buffer) {
    addHash(found, rel, hashText(bytes));

    if (rel === SETTINGS)
      for (const command of settingsCommands(bytes)) addHash(found, HOOK_COMMANDS_KEY, hashText(command));
  }

  for (const [rel, bytes] of loggedFiles(repoRoot, refs)) addFile(rel, bytes);

  for (const [rel, bytes] of currentFiles(repoRoot, source)) addFile(rel, bytes);

  return Object.fromEntries(
    [...found].toSorted(([a], [b]) => byCodeUnit(a, b)).map(([rel, hashes]) => [rel, [...hashes].toSorted(byCodeUnit)]),
  );
}

function addHash(found: Map<string, Set<string>>, rel: string, hash: string): void {
  found.set(rel, (found.get(rel) ?? new Set<string>()).add(hash));
}

/** Whether a git file mode is a regular file's; a symlink's blob is its target text, which no copy ever holds. */
function isRegular(mode: string | undefined): boolean {
  return mode?.startsWith(REGULAR_MODE) === true;
}

/** Every added or modified regular-file blob of a stock path in the history of `refs`, merges included, by path. */
function loggedFiles(repoRoot: string, refs: readonly string[]): [string, Buffer][] {
  const log = git(repoRoot, ["log", ...refs, ...LOG_ARGS, "--", ...STOCK_PREFIXES]);

  const tokens = log
    .toString("utf8")
    .split("\0")
    .filter((token) => token !== "");

  const paths = new Map<string, string[]>();

  for (let i = 0; i + 1 < tokens.length; i += LOG_TOKENS_PER_ENTRY) {
    const [, mode, , blob] = (tokens[i] ?? "").split(" ");
    const rel = tokens[i + 1];

    if (isRegular(mode) && blob !== undefined && rel !== undefined) paths.set(blob, [...(paths.get(blob) ?? []), rel]);
  }

  const contents = readBlobs(repoRoot, [...paths.keys()]);

  return [...paths].flatMap(([blob, rels]) => {
    const bytes = contents.get(blob);

    return bytes === undefined ? [] : rels.map((rel): [string, Buffer] => [rel, bytes]);
  });
}

/** Where the current version of each stock file is read from. */
type CurrentSource = "tree" | "index";

/** Every regular stock file as `[path, bytes]`, from the working tree or the index. */
function currentFiles(repoRoot: string, source: CurrentSource): [string, Buffer][] {
  if (source === "tree") return workingFiles(repoRoot).map((rel) => [rel, fs.readFileSync(path.join(repoRoot, rel))]);

  const listed = git(repoRoot, [...LS_FILES_ARGS, "--", ...STOCK_PREFIXES])
    .toString("utf8")
    .split("\0");

  const entries = listed.flatMap((entry) => {
    const [mode = "", blob = "", , rel = ""] = entry.split(FIELD_SEP);

    return isRegular(mode) ? [{ blob, rel }] : [];
  });

  const blobs = readBlobs(repoRoot, [...new Set(entries.map((entry) => entry.blob))]);

  return entries.flatMap(({ blob, rel }) => {
    const bytes = blobs.get(blob);

    return bytes === undefined ? [] : [[rel, bytes]];
  });
}

/** The hook commands of a settings file's bytes; none when it is not JSON. */
function settingsCommands(bytes: Buffer): string[] {
  try {
    return hookCommands(JSON.parse(bytes.toString("utf8")));
  } catch {
    return [];
  }
}

function git(cwd: string, args: string[], input?: string): Buffer {
  const result = spawnSync("git", args, { cwd, input, maxBuffer: GIT_MAX_BUFFER });

  if (result.status !== 0)
    throw new Error(`git ${args.slice(0, GIT_ERROR_WORDS).join(" ")} failed: ${result.stderr.toString().trim()}`);

  return result.stdout;
}

/** The text of each blob, by object id, through one `git cat-file --batch`. */
function readBlobs(repoRoot: string, ids: string[]): Map<string, Buffer> {
  const out = git(repoRoot, [...CAT_FILE_ARGS], ids.map((id) => `${id}\n`).join(""));
  const result = new Map<string, Buffer>();
  let at = 0;

  while (at < out.length) {
    const eol = out.indexOf("\n", at);
    const [id = "", , size = ""] = out.toString("utf8", at, eol).split(" ");
    const start = eol + 1;
    result.set(id, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }

  return result;
}

/** Every file in the working tree under a stock prefix. */
function workingFiles(repoRoot: string): string[] {
  const files: string[] = [];

  function walk(rel: string) {
    const stat = fs.statSync(path.join(repoRoot, rel), { throwIfNoEntry: false });

    if (stat?.isDirectory() === true)
      for (const name of fs.readdirSync(path.join(repoRoot, rel))) walk(`${rel}/${name}`);
    else if (stat?.isFile() === true) files.push(rel);
  }

  for (const prefix of STOCK_PREFIXES) walk(prefix.replace(TRAILING_SLASH, ""));

  return files;
}

/** The stock history as the file holds it: every key in code-unit order. */
export function historyText(history: StockHistory): string {
  return sortedJsonValue(history);
}

/** Writes the stock history file, formats it with the repo's formatter and prints the path count. */
function run(_argv: string[], io: Io): number {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const history = collectHistory(root);
  fs.writeFileSync(STOCK_HISTORY_FILE, historyText(history));

  // The repo's formatter owns the layout, so `repo fmt --check` and this script agree on the bytes.
  const fmt = spawnSync(process.execPath, [path.join(root, REPO_BIN), ...FMT_ARGS, STOCK_HISTORY_FILE], {
    cwd: root,
    stdio: "inherit",
  });

  if (fmt.status !== 0) throw new Error(`repo fmt failed on ${STOCK_HISTORY_FILE}`);
  io.out(`wrote ${path.relative(root, STOCK_HISTORY_FILE)}: ${Object.keys(history).length} paths`);

  return 0;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(ARGV_START), processIo);
