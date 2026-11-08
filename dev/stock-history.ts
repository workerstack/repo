#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HOOK_COMMANDS_KEY, STOCK_HISTORY_FILE, STOCK_PREFIXES, hashText, hookCommands, type StockHistory } from "../cli/sync/stock-history.ts";

/**
 * Writes `cli/sync/stock-history.json`: for every stock path a copied install can hold (`STOCK_PREFIXES`), the hash
 * of every version git history has had on `main` and `HEAD` plus the version in the working tree. The migration
 * reads it to tell an unedited copy of an old stock file from the consumer's own edit. The key
 * `.claude/settings.json#commands` holds the hash of every hook command those settings files ever ran.
 *
 * Rerun it before each release, and after any change to a stock file (`bun dev/stock-history.ts`): a stock file
 * whose current text is missing from the table fails `dev/stock-history.test.ts`. It is deterministic and safe to
 * rerun.
 */
export function collectHistory(repoRoot: string, refs: readonly string[] = ["main", "HEAD"]): StockHistory {
  const found = new Map<string, Set<string>>();
  const add = (rel: string, hash: string) => {
    const set = found.get(rel) ?? new Set<string>();
    set.add(hash);
    found.set(rel, set);
  };

  // Every added or modified blob of a stock path in the history of `refs`, merges included.
  const log = git(repoRoot, ["log", ...refs, "-m", "--no-renames", "--diff-filter=AM", "--raw", "--no-abbrev", "-z", "--format=", "--", ...STOCK_PREFIXES]);
  const tokens = log.toString("utf8").split("\0").filter((token) => token !== "");
  const blobs = new Map<string, string[]>();
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const blob = tokens[i]!.split(" ")[3]!;
    blobs.set(blob, [...(blobs.get(blob) ?? []), tokens[i + 1]!]);
  }
  const addFile = (rel: string, bytes: Buffer) => {
    add(rel, hashText(bytes));
    if (rel === SETTINGS) for (const command of settingsCommands(bytes)) add(HOOK_COMMANDS_KEY, hashText(command));
  };
  for (const [blob, bytes] of readBlobs(repoRoot, [...blobs.keys()])) for (const rel of blobs.get(blob)!) addFile(rel, bytes);

  for (const rel of workingFiles(repoRoot)) addFile(rel, fs.readFileSync(path.join(repoRoot, rel)));

  return Object.fromEntries([...found].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rel, hashes]) => [rel, [...hashes].sort()]));
}

/** The table as file text: one path per line, so a rerun that adds a version changes one line. */
export function renderHistory(history: StockHistory): string {
  const rows = Object.entries(history).map(([rel, hashes]) => `  ${JSON.stringify(rel)}: ${JSON.stringify(hashes)}`);
  return `{\n${rows.join(",\n")}\n}\n`;
}

const SETTINGS = ".claude/settings.json";

/** The hook commands of a settings file's bytes; none when it is not JSON. */
function settingsCommands(bytes: Buffer): string[] {
  try {
    return hookCommands(JSON.parse(bytes.toString("utf8")));
  } catch {
    return [];
  }
}

function git(cwd: string, args: string[], input?: string): Buffer {
  const run = spawnSync("git", args, { cwd, input, maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`git ${args.slice(0, 2).join(" ")} failed: ${run.stderr.toString().trim()}`);
  return run.stdout;
}

/** The text of each blob, by object id, through one `git cat-file --batch`. */
function readBlobs(repoRoot: string, ids: string[]): Map<string, Buffer> {
  const out = git(repoRoot, ["cat-file", "--batch"], ids.map((id) => `${id}\n`).join(""));
  const result = new Map<string, Buffer>();
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf("\n", at);
    const [id, , size] = out.toString("utf8", at, eol).split(" ");
    const start = eol + 1;
    result.set(id!, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return result;
}

/** Every file in the working tree under a stock prefix. */
function workingFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (rel: string) => {
    const stat = fs.statSync(path.join(repoRoot, rel), { throwIfNoEntry: false });
    if (stat?.isDirectory()) for (const name of fs.readdirSync(path.join(repoRoot, rel))) walk(`${rel}/${name}`);
    else if (stat?.isFile()) files.push(rel);
  };
  for (const prefix of STOCK_PREFIXES) walk(prefix.replace(/\/$/, ""));
  return files;
}

if (import.meta.main) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const text = renderHistory(collectHistory(root));
  fs.writeFileSync(STOCK_HISTORY_FILE, text);
  console.log(`wrote ${path.relative(root, STOCK_HISTORY_FILE)}: ${text.split("\n").length - 3} paths, ${text.length} bytes`);
}
