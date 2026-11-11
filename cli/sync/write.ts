import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { MANIFEST_REL } from "./manifest.ts";
import type { Output } from "./outputs.ts";
import { ownedMode, unlock } from "./write-modes.ts";
import { PERMISSION_BITS, TEMP_NAME_BYTES } from "./write.constants.ts";

/** Seams: the platform links are made for, and how one output is written (null on success, else the error text). */
export type WriteDeps = {
  platform: NodeJS.Platform;
  writeOutput?: ((root: string, output: Output, platform: NodeJS.Platform) => string | null) | undefined;
};
/** `refused` is true when nothing was attempted; otherwise a failed write was undone. */
export type WriteResult = { ok: true } | { ok: false; errors: string[]; refused: boolean };

/** What sat at a path before sync touched it. A `dir` is never replaced, so it needs no restoring. */
type Prior =
  | { kind: "absent" }
  | { kind: "dir" }
  | { kind: "file"; bytes: Buffer; mode: number }
  | { kind: "link"; target: string };
/** One touched path: its prior state, the dirs the step created above it, and whether the step finished. */
type Entry = { abs: string; prior: Prior; created: string[]; done: boolean; counted: boolean };

/** Writes one output: a file through a temp file and rename, a link replaced by a new one. Null on success. */
export function writeOutput(root: string, output: Output, platform: NodeJS.Platform): string | null {
  const abs = path.join(root, output.path);
  if (output.kind === "link") return writeLink(abs, output.target, platform);
  return writeOwned(abs, output.content, ownedMode(output, platform));
}

/** Whether `file` already holds exactly the bytes of `content`; a missing or unreadable file is not current. */
export function isCurrent(file: string, content: string): boolean {
  try {
    return fs.readFileSync(file).equals(Buffer.from(content));
  } catch {
    return false;
  }
}

/**
 * Writes the changed outputs, removes the pruned paths, then the manifest, all or nothing. A link path that holds a
 * real directory is refused before anything is written. Any failure puts every file, link, removal and dir back as
 * it was, so a rerun starts from the old state.
 */
export function writeAll(
  root: string,
  changed: readonly Output[],
  prune: readonly string[],
  manifest: string,
  deps: WriteDeps,
): WriteResult {
  const refusals = changed.flatMap((output) =>
    output.kind === "link" && isRealDir(path.join(root, output.path)) ? [refusal(output.path)] : [],
  );
  if (refusals.length > 0) return { errors: refusals, ok: false, refused: true };

  const write = deps.writeOutput ?? writeOutput;
  const journal: Entry[] = [];
  const failed = (message: string): WriteResult => ({
    errors: [undo(root, journal, message)],
    ok: false,
    refused: false,
  });

  for (const output of changed) {
    const abs = path.join(root, output.path);
    const error = step(journal, abs, true, missingDirs(path.dirname(abs)), () => write(root, output, deps.platform));
    if (error !== null) return failed(`${output.path}: cannot write: ${error}`);
  }
  for (const rel of prune) {
    const error = step(journal, path.join(root, rel), true, [], () => removePath(root, rel));
    if (error !== null) return failed(`${rel}: cannot remove: ${error}`);
  }
  // Last, so a run killed before here is redone from the old manifest and converges.
  const manifestAbs = path.join(root, MANIFEST_REL);
  if (!isCurrent(manifestAbs, manifest)) {
    const error = step(journal, manifestAbs, false, missingDirs(path.dirname(manifestAbs)), () =>
      writeOwned(manifestAbs, manifest, null),
    );
    if (error !== null) return failed(`${MANIFEST_REL}: cannot write: ${error}`);
  }
  return { ok: true };
}

/** Whether anything, a dangling link included, is at `abs`; a path below a file is not. */
function isPresent(abs: string): boolean {
  try {
    fs.lstatSync(abs);
    return true;
  } catch {
    return false;
  }
}

function isRealDir(abs: string): boolean {
  try {
    return fs.lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** The line for a link path that holds a real dir; a skill link points the user at `.repo/skills/`. */
function refusal(rel: string): string {
  const skill = /^\.(?:agents|claude)\/skills\/([^/]+)$/.exec(rel);
  const fix = skill === null ? "move or delete it" : `move it to .repo/skills/${skill[1]}`;
  return `${rel} is a folder where sync puts a link; ${fix}`;
}

/** The dirs from the first missing one down to `dir`, outermost first: what a mkdir of `dir` would create. */
function missingDirs(dir: string): string[] {
  const dirs: string[] = [];
  for (let at = dir; !fs.existsSync(at); at = path.dirname(at)) dirs.unshift(at);
  return dirs;
}

function capture(abs: string): Prior {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return { kind: "absent" };
  }
  if (stat.isSymbolicLink()) return { kind: "link", target: fs.readlinkSync(abs) };
  if (stat.isDirectory()) return { kind: "dir" };
  return { bytes: fs.readFileSync(abs), kind: "file", mode: stat.mode };
}

/** Records `abs`'s prior state, then runs the step; its error text, or null. A path that cannot be recorded is not touched. */
function step(
  journal: Entry[],
  abs: string,
  counted: boolean,
  created: string[],
  run: () => string | null,
): string | null {
  let prior: Prior;
  try {
    prior = capture(abs);
  } catch (error) {
    return (error as Error).message;
  }
  const entry: Entry = { abs, counted, created, done: false, prior };
  journal.push(entry);
  const error = run();
  entry.done = error === null;
  return error;
}

/** Puts every journaled path back, newest first, and returns `message` with what happened. */
function undo(root: string, journal: readonly Entry[], message: string): string {
  const stuck: string[] = [];
  const attempt = (abs: string, action: () => void) => {
    try {
      action();
    } catch {
      stuck.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  for (const entry of [...journal].reverse()) {
    attempt(entry.abs, () => restorePath(entry));
    for (const dir of [...entry.created].reverse()) attempt(dir, () => fs.existsSync(dir) && fs.rmdirSync(dir));
  }
  if (stuck.length > 0) return `${message}; could not restore ${stuck.join(", ")}; run \`bun repo sync\` again`;
  const count = journal.filter((entry) => entry.done && entry.counted).length;
  return `${message}; restored ${count} output${count === 1 ? "" : "s"}, nothing changed`;
}

function restorePath({ abs, prior }: Entry): void {
  if (prior.kind === "dir") return;
  unlock(abs);
  // A file written through a link would land in the link's target, so whatever is there goes first.
  if (isPresent(abs)) fs.rmSync(abs);
  if (prior.kind === "absent") return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (prior.kind === "link") {
    // The type is ignored off win32; there a junction is what sync makes.
    fs.symlinkSync(prior.target, abs, "junction");
  } else {
    fs.writeFileSync(abs, prior.bytes);
    fs.chmodSync(abs, prior.mode & PERMISSION_BITS);
  }
}

/** Removes a file or link, then every parent dir it leaves empty, up to but never including the root. */
function removePath(root: string, rel: string): string | null {
  try {
    unlock(path.join(root, rel));
    fs.rmSync(path.join(root, rel), { force: true });
    for (let dir = path.dirname(path.join(root, rel)); dir !== root; dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
    }
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Replaces whatever is at `abs` with a directory link; a junction with an absolute target on win32. */
function writeLink(abs: string, target: string, platform: NodeJS.Platform): string | null {
  try {
    unlock(abs);
    fs.rmSync(abs, { force: true, recursive: true });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (platform === "win32") fs.symlinkSync(path.resolve(path.dirname(abs), target), abs, "junction");
    else fs.symlinkSync(target, abs, "dir");
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Writes through a temp file in the same dir and a rename, so a crash never leaves a half-written file; `mode`, when
 * not null, is set on the temp file, so the file never exists without it. A read-only file there is made writable
 * first, since win32 refuses a rename onto it. Null on success, else the error text. A writer outside sync of a
 * file sync owns passes `OWNED_MODE`.
 */
export function writeOwned(file: string, content: string, mode: number | null): string | null {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(TEMP_NAME_BYTES).toString("hex")}.tmp`,
  );
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, content);
    if (mode !== null) fs.chmodSync(temp, mode);
    unlock(file);
    fs.renameSync(temp, file);
    return null;
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // the temp file's dir is unusable, so there is no temp file to remove
    }
    return (error as Error).message;
  }
}
