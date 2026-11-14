import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { removeTree } from "../remove-tree.ts";
import { MANIFEST_REL } from "./manifest.ts";
import type { Output } from "./outputs.ts";
import { type JournalEntry, journalStep, undoJournal } from "./write-journal.ts";
import { ownedMode, unlock } from "./write-modes.ts";
import { SKILL_LINK, TEMP_NAME_BYTES, WINDOWS_PLATFORM } from "./write.constants.ts";

/** Seams: the platform links are made for, and how one output is written (null on success, else the error text). */
export type WriteDeps = {
  platform: NodeJS.Platform;
  writeOutput?: ((root: string, output: Output, platform: NodeJS.Platform) => string | null) | undefined;
};

/** `refused` is true when nothing was attempted; otherwise a failed write was undone. */
export type WriteResult = { ok: true } | { ok: false; errors: string[]; refused: boolean };

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

/** The changed outputs to write, the paths to prune, and the manifest text to write last. */
export type WritePlan = { changed: readonly Output[]; prune: readonly string[]; manifest: string };

/** One run of `writeAll`: where, what, how, and the journal its undo reads. */
type Run = { root: string; plan: WritePlan; deps: WriteDeps; journal: JournalEntry[] };

/**
 * Writes the changed outputs, removes the pruned paths, then the manifest, all or nothing. A link path that holds a
 * real directory is refused before anything is written. Any failure puts every file, link, removal and dir back as
 * it was, so a rerun starts from the old state.
 */
export function writeAll(root: string, plan: WritePlan, deps: WriteDeps): WriteResult {
  const refusals = plan.changed.flatMap((output) =>
    output.kind === "link" && isRealDir(path.join(root, output.path)) ? [refusal(output.path)] : [],
  );

  if (refusals.length > 0) return { errors: refusals, ok: false, refused: true };
  const journal: JournalEntry[] = [];
  const message = writeSteps({ deps, journal, plan, root });

  if (message === null) return { ok: true };

  return { errors: [undoJournal(root, journal, message)], ok: false, refused: false };
}

/** Writes the outputs, then removes the pruned paths, then writes the manifest; the first failure's line, or null. */
function writeSteps(run: Run): string | null {
  const { deps, journal, plan, root } = run;
  const write = deps.writeOutput ?? writeOutput;

  for (const output of plan.changed) {
    const abs = path.join(root, output.path);
    const created = missingDirs(path.dirname(abs));
    const error = journalStep(journal, { abs, counted: true, created, run: () => write(root, output, deps.platform) });

    if (error !== null) return `${output.path}: cannot write: ${error}`;
  }

  for (const rel of plan.prune) {
    const step = { abs: path.join(root, rel), counted: true, created: [], run: () => removePath(root, rel) };
    const error = journalStep(journal, step);

    if (error !== null) return `${rel}: cannot remove: ${error}`;
  }

  return writeManifest(run);
}

/** Writes the manifest unless it is current; last, so a run killed before here is redone from the old manifest. */
function writeManifest({ journal, plan, root }: Run): string | null {
  const abs = path.join(root, MANIFEST_REL);

  if (isCurrent(abs, plan.manifest)) return null;
  const created = missingDirs(path.dirname(abs));
  const error = journalStep(journal, { abs, counted: false, created, run: () => writeOwned(abs, plan.manifest, null) });

  return error === null ? null : `${MANIFEST_REL}: cannot write: ${error}`;
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
  const skill = SKILL_LINK.exec(rel)?.groups?.name;
  const fix = skill === undefined ? "move or delete it" : `move it to .repo/skills/${skill}`;

  return `${rel} is a folder where sync puts a link; ${fix}`;
}

/** The dirs from the first missing one down to `dir`, outermost first: what a mkdir of `dir` would create. */
function missingDirs(dir: string): string[] {
  const dirs: string[] = [];

  for (let at = dir; !fs.existsSync(at); at = path.dirname(at)) dirs.unshift(at);

  return dirs;
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
    return (error /* fs throws an Error */ as Error).message;
  }
}

/** Replaces whatever is at `abs` with a directory link; a junction with an absolute target on win32. */
function writeLink(abs: string, target: string, platform: NodeJS.Platform): string | null {
  try {
    unlock(abs);
    removeTree(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    if (platform === WINDOWS_PLATFORM) fs.symlinkSync(path.resolve(path.dirname(abs), target), abs, "junction");
    else fs.symlinkSync(target, abs, "dir");

    return null;
  } catch (error) {
    return (error /* fs throws an Error */ as Error).message;
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

    return (error /* fs throws an Error */ as Error).message;
  }
}
