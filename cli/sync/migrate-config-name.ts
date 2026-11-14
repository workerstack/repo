// The move from the config's old name to `CONFIG_FILE`; the one place outside its tests that names the old file and
// type.
import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { listFiles } from "../list-files.ts";
import { CHANGELOG_FILE } from "../update.constants.ts";

const OLD_CONFIG_FILE = "workerstack.config.ts";
const OLD_TYPE = /\bWorkerstackConfig\b/g;
const NEW_TYPE = "RepoConfig";
const OLD_FILE = /workerstack\.config\.ts/g;

/** The bytes a file is read for a NUL in, which marks it binary, as git judges it. */
const SNIFF_BYTES = 8000;

/** The owner-write mode bit, set while a read-only file is rewritten. */
const OWNER_WRITE = 0o200;

const IS_NOW = `${OLD_CONFIG_FILE} is now ${CONFIG_FILE}; run bun repo sync`;
const OLD_KEY = /\bdefaultMode(?=\s*:)/g;
const NEW_KEY = "defaultApproval";
const KEY_IS_NOW = `${CONFIG_FILE}: agents.defaultMode is now agents.defaultApproval; run bun repo sync`;
const BOTH = `both ${OLD_CONFIG_FILE} and ${CONFIG_FILE} exist; delete one`;

/**
 * What `moveOldConfig` did in `dir`: the files it rewrote before the move, or why it did not move; null when there
 * was nothing to move.
 */
export type ConfigMove =
  | { kind: "moved"; dir: string; rewritten: string[]; keyRenamed: boolean }
  | { kind: "key-renamed"; dir: string }
  | { kind: "error"; dir: string; error: string }
  | null;

/** The nearest dir at or above a cwd holding either name, and which names it holds. */
type Found = { dir: string; old: boolean; current: boolean };

function nearest(cwd: string): Found | null {
  let dir = path.resolve(cwd);

  for (;;) {
    const old = fs.existsSync(path.join(dir, OLD_CONFIG_FILE));
    const current = fs.existsSync(path.join(dir, CONFIG_FILE));

    if (old || current) return { current, dir, old };
    const parent = path.dirname(dir);

    if (parent === dir) return null;
    dir = parent;
  }
}

/** Rewrites both old names in the text file at `rel` under `dir`; whether its text changed. */
function rewriteFile(dir: string, rel: string): boolean {
  const file = path.join(dir, rel);

  if (path.basename(rel) === CHANGELOG_FILE || fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() !== true)
    return false;
  const bytes = fs.readFileSync(file);

  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return false;
  const text = bytes.toString("utf8");
  const next = text.replaceAll(OLD_TYPE, NEW_TYPE).replaceAll(OLD_FILE, CONFIG_FILE);

  if (next === text) return false;
  const { mode } = fs.statSync(file);
  fs.chmodSync(file, mode | OWNER_WRITE);
  fs.writeFileSync(file, next);
  fs.chmodSync(file, mode);

  return true;
}

/** Rewrites `defaultMode` to `defaultApproval` in the config at `dir`; whether its text changed. */
function renameDefaultKey(dir: string, { check }: { check: boolean }): boolean {
  const file = path.join(dir, CONFIG_FILE);
  const text = fs.readFileSync(file, "utf8");
  const next = text.replaceAll(OLD_KEY, NEW_KEY);

  if (next === text) return false;

  if (!check) fs.writeFileSync(file, next);

  return true;
}

/**
 * Moves the old config at or above `cwd` to `CONFIG_FILE`: first rewrites both old names in every text file git
 * lists there, then renames the file, so a run that stops before the rename finishes on the next. A changelog keeps
 * the names its history was written with, and binaries are left alone. Under `check`, or beside a file of the new
 * name, it writes nothing and says why.
 */
export function moveOldConfig(cwd: string, { check }: { check: boolean }): ConfigMove {
  const found = nearest(cwd);

  if (found === null) return null;
  const { dir } = found;

  if (!found.old) {
    if (!renameDefaultKey(dir, { check })) return null;

    return check ? { dir, error: KEY_IS_NOW, kind: "error" } : { dir, kind: "key-renamed" };
  }

  if (found.current) return { dir, error: BOTH, kind: "error" };

  if (check) return { dir, error: IS_NOW, kind: "error" };
  // Outside git nothing is listed, so the config itself is always rewritten.
  const listed = new Set([...listFiles(dir), OLD_CONFIG_FILE]);
  const rewritten = [...listed].filter((rel) => rewriteFile(dir, rel));
  fs.renameSync(path.join(dir, OLD_CONFIG_FILE), path.join(dir, CONFIG_FILE));

  const keyRenamed = renameDefaultKey(dir, { check: false });

  return { dir, keyRenamed, kind: "moved", rewritten };
}

/** The lines a move prints: the rewrite, left out when no file changed, then the rename. */
export function moveLines(rewritten: readonly string[]): string[] {
  const count = rewritten.length;
  const files = `${count} file${count === 1 ? "" : "s"}`;
  const rewrote = count === 0 ? [] : [`rewrote WorkerstackConfig and ${OLD_CONFIG_FILE} in ${files}`];

  return [...rewrote, `moved ${OLD_CONFIG_FILE} to ${CONFIG_FILE}`];
}

/** The line a rewrite of the config's `defaultMode` prints. */
export const KEY_RENAMED: string = `renamed agents.defaultMode to agents.defaultApproval in ${CONFIG_FILE}`;

/** The line that tells a repo whose nearest config has the old name to sync; null for any other repo. */
export function oldConfigHint(cwd: string): string | null {
  const found = nearest(cwd);

  return found !== null && found.old && !found.current ? IS_NOW : null;
}
