import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import type { Result } from "../result.ts";
import { errorMessage } from "../sync-errors.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { HOOK_COMMANDS_KEY, STOCK_PREFIXES, hashText, hookCommands, type StockHistory } from "../sync/stock-history.ts";
import { sortedJsonValue } from "./json-keys.ts";
import { captureSorted } from "./lint.ts";
import {
  CAT_FILE_ARGS,
  DEFAULT_REFS,
  GIT_ERROR_WORDS,
  GIT_MAX_BUFFER,
  LOG_ARGS,
  LOG_TOKENS_PER_ENTRY,
  LS_FILES_ARGS,
  REGULAR_MODE,
  SETTINGS,
  STOCK_HISTORY_REL,
  SYMLINK_MODE,
} from "./stock-history-collect.constants.ts";

const TRAILING_SLASH = /\/$/;

/**
 * The stock history table: for every stock path a copied install can hold (`STOCK_PREFIXES`), the hash of every
 * version git history has had on `refs` plus the current version. The migration reads it to tell an unedited copy of
 * an old stock file from the consumer's own edit. The key `.claude/settings.json#commands` holds the hash of every
 * hook command those settings files ever ran.
 *
 * `source` picks the current stock files: the working tree or the git index (`"index"`, what a commit holds, so a
 * tool that rewrites files in the tree cannot fail the currency test).
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
function isRegular(mode: string): boolean {
  return mode.startsWith(REGULAR_MODE);
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
    const record = tokens[i] /* i + 1 < tokens.length */ as string;
    const rel = tokens[i + 1] /* i + 1 < tokens.length */ as string;

    const fields = record.split(" ") /* :<old mode> <new mode> <old blob> <new blob> <status> */ as [
      string,
      string,
      string,
      string,
      string,
    ];

    const [, mode, , blob] = fields;

    if (isRegular(mode)) paths.set(blob, [...(paths.get(blob) ?? []), rel]);
  }

  const contents = readBlobs(repoRoot, [...paths.keys()]);

  return [...paths].flatMap(([blob, rels]) => {
    const bytes = contents.get(blob) /* readBlobs answers every id it is asked */ as Buffer;

    return rels.map((rel): [string, Buffer] => [rel, bytes]);
  });
}

/** Where the current version of each stock file is read from. */
export type CurrentSource = "tree" | "index";

/** Whether `rel` is under a `STOCK_PREFIXES` dir or is one of its files. */
export function isStockPath(rel: string): boolean {
  return STOCK_PREFIXES.some((prefix) => (prefix.endsWith("/") ? rel.startsWith(prefix) : rel === prefix));
}

type IndexEntry = { mode: string; blob: string; rel: string };

/** Every index entry: `ls-files -s` prints `<mode> <blob> <stage>`, a tab, then the path. */
function indexEntries(repoRoot: string): IndexEntry[] {
  const listed = git(repoRoot, [...LS_FILES_ARGS])
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry !== "");

  return listed.map((entry) => {
    const tab = entry.indexOf("\t");
    const [mode, blob] = entry.slice(0, tab).split(" ") /* <mode> <blob> <stage> */ as [string, string, string];

    return { blob, mode, rel: entry.slice(tab + 1) };
  });
}

/**
 * The regular files a staged symlink at a stock path reads through, at the link's path, as the working tree walk
 * reads them: a link to a file gives that file, a link to a dir every file under it.
 */
function throughLinks(repoRoot: string, entries: readonly IndexEntry[]): { blob: string; rel: string }[] {
  const links = entries.filter((entry) => entry.mode === SYMLINK_MODE && isStockPath(entry.rel));

  const targets = readBlobs(
    repoRoot,
    links.map((link) => link.blob),
  );

  const regular = entries.filter((entry) => isRegular(entry.mode));

  return links.flatMap((link) => {
    const text = String(targets.get(link.blob) /* every id is answered */);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(link.rel), text));
    const under = regular.filter((entry) => entry.rel === target || entry.rel.startsWith(`${target}/`));

    return under.map((entry) => ({ blob: entry.blob, rel: `${link.rel}${entry.rel.slice(target.length)}` }));
  });
}

/** Every stock file as `[path, bytes]`, from the working tree or the index, read through a symlink in both. */
function currentFiles(repoRoot: string, source: CurrentSource): [string, Buffer][] {
  if (source === "tree") return workingFiles(repoRoot).map((rel) => [rel, fs.readFileSync(path.join(repoRoot, rel))]);
  const all = indexEntries(repoRoot);
  const stock = all.filter((entry) => isRegular(entry.mode) && isStockPath(entry.rel));
  const entries = [...stock, ...throughLinks(repoRoot, all)];
  const blobs = readBlobs(repoRoot, [...new Set(entries.map((entry) => entry.blob))]);

  return entries.map(({ blob, rel }): [string, Buffer] => [rel, blobs.get(blob) /* every id is answered */ as Buffer]);
}

/** The hook commands of a settings file's bytes; none when it is not a JSON object. */
function settingsCommands(bytes: Buffer): string[] {
  return hookCommands(tryJson(z.json(), bytes.toString("utf8")));
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
    const head = out.toString("utf8", at, eol);
    const [id, , size] = head.split(" ") /* cat-file --batch heads: <id> <type> <size> */ as [string, string, string];
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

/** What a write of the table did: how many paths it holds, and whether its bytes changed. */
export type Written = { paths: number; changed: boolean };

/**
 * Writes the table of `root`'s checkout from `refs` and `source`, formatted as `repo turn` formats it, so `repo fmt
 * --check` and this write agree on the bytes; a git or formatter failure is the error's lines.
 */
export function writeStockHistory(root: string, refs: readonly string[], source: CurrentSource): Result<Written> {
  const file = path.join(root, STOCK_HISTORY_REL);
  const before = fs.readFileSync(file, "utf8");
  let history: StockHistory;

  try {
    history = collectHistory(root, refs, source);
  } catch (error) {
    return { error: [`${errorMessage(error)}\n`], ok: false };
  }

  fs.writeFileSync(file, historyText(history));
  const fmt = captureSorted([STOCK_HISTORY_REL], root);

  if (fmt.code !== 0) return { error: [`${fmt.stdout}${fmt.stderr}`], ok: false };

  return { ok: true, value: { changed: fs.readFileSync(file, "utf8") !== before, paths: Object.keys(history).length } };
}
