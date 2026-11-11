import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "../spawn.ts";
import { normalizeRel } from "./manifest.ts";
import { COPIED_DIR, COPIED_MARKER, HOST_SKILL_DIRS, TEMP_BYTES } from "./migrate.constants.ts";
import { unlock } from "./write-modes.ts";

const SCRIPTS = "/scripts/";

/** Whether anything, a dangling link included, is at `abs`. */
export function present(abs: string): boolean {
  return fs.lstatSync(abs, { throwIfNoEntry: false }) !== undefined;
}

/** Whether `abs` is a directory itself, not a link to one. */
export function isRealDir(abs: string): boolean {
  return fs.lstatSync(abs, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** Whether `abs` is a directory itself; false when it cannot be read either. */
export function isDir(abs: string): boolean {
  try {
    return fs.lstatSync(abs, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** Equal text, whatever the line endings. */
export function same(a: string, b: string): boolean {
  return a.replaceAll("\r\n", "\n") === b.replaceAll("\r\n", "\n");
}

/** Every file under `dir` as a `/` path relative to it. */
export function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

/**
 * Where the stock package keeps the file a copied install has at `rel`: its copied `.rulesync/scripts` are
 * `cli/scripts`, the rest of `.rulesync/` is under `agents/`, and a skill in either host skill dir is in
 * `agents/skills`. Other paths are the same.
 */
export function stockRel(rel: string): string {
  if (rel.startsWith(`${COPIED_DIR}${SCRIPTS}`)) return `cli/scripts/${rel.slice(COPIED_DIR.length + SCRIPTS.length)}`;
  if (rel.startsWith(`${COPIED_DIR}/`)) return `agents/${rel.slice(COPIED_DIR.length + 1)}`;
  const skills = HOST_SKILL_DIRS.find((dir) => rel.startsWith(dir));
  return skills === undefined ? rel : `agents/skills/${rel.slice(skills.length)}`;
}

/** Whether moving `src` to `dst` would overwrite other text; children named in `except` do not move. */
export function clashes(src: string, dst: string, except: readonly string[]): boolean {
  if (!present(dst)) return false;
  if (isDir(src) && isDir(dst)) {
    return fs
      .readdirSync(src)
      .filter((name) => !except.includes(name))
      .some((name) => clashes(path.join(src, name), path.join(dst, name), []));
  }
  if (isDir(src) || isDir(dst)) return true;
  return !same(fs.readFileSync(src, "utf8"), fs.readFileSync(dst, "utf8"));
}

/** Renames `src` to `dst`; into an existing dir it goes entry by entry, and an equal file just goes. */
export function moveTree(src: string, dst: string, except: readonly string[]): void {
  if (!present(dst) && except.length === 0) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  } else if (isDir(src)) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src).filter((entry) => !except.includes(entry))) {
      moveTree(path.join(src, name), path.join(dst, name), []);
    }
    if (except.length === 0) fs.rmdirSync(src);
  } else if (same(fs.readFileSync(src, "utf8"), fs.readFileSync(dst, "utf8"))) fs.rmSync(src);
  else throw new Error(`cannot move ${src}: ${dst} already exists and differs`);
}

/** Writes `content` to `file` through a temp file and a rename; a read-only file there is made writable first, as win32 needs. */
export function writeAtomic(file: string, content: string): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(TEMP_BYTES).toString("hex")}.tmp`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, content);
  unlock(file);
  fs.renameSync(temp, file);
}

/** The paths git tracks, as root-relative `/` spellings: backslashes, a drive prefix and `./` all read the same. */
export function trackedRels(raw: readonly string[], root: string): string[] {
  return raw.flatMap((entry) => normalizeRel(entry, root) ?? []);
}

/** Which of `paths` git tracks, as git prints them; null outside a git repo. */
export function gitTracked(root: string, paths: string[]): string[] | null {
  if (!present(path.join(root, ".git"))) return null;
  const result = spawnSync("git", ["ls-files", "-z", "--", ...paths], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.split("\0").filter((entry) => entry !== "") : null;
}

/** Takes `paths` out of the index and leaves the files, so sync can regenerate them as ignored. */
export function untrack(root: string, paths: readonly string[]): void {
  const result = spawnSync("git", ["rm", "-r", "--cached", "-q", "--", ...paths], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git rm --cached failed: ${result.stderr.trim()}`);
}

/**
 * Removes `paths`, each read-only file made writable first, as win32 needs; the copied dir loses everything but the
 * marker first, so the marker is the last file to go.
 */
export function removeAll(root: string, paths: readonly string[]): void {
  for (const rel of paths) {
    const abs = path.join(root, rel);
    unlock(abs);
    if (rel === COPIED_DIR) {
      for (const file of filesUnder(abs).filter((entry) => `${COPIED_DIR}/${entry}` !== COPIED_MARKER)) {
        fs.rmSync(path.join(abs, file), { force: true });
      }
    }
    fs.rmSync(abs, { recursive: true, force: true });
  }
}
