import fs from "node:fs";
import path from "node:path";
import type { Output } from "./outputs.ts";
import { cutRegions, hasMarkers, syntaxOf } from "./region.ts";
import { writeOutput } from "./write.ts";
import { unlock } from "./write-modes.ts";

/** A shared file no output writes any more: its text with every region cut, and one line per region cut. */
export type Cut = { path: string; text: string; repairs: string[] };
/** How `applyCuts` writes: the platform, and the one-output writer sync's deps may swap in. */
export type CutWrite = {
  platform: NodeJS.Platform;
  writeOutput?: ((root: string, output: Output, platform: NodeJS.Platform) => string | null) | undefined;
};

/** One `path: repair` line per repair a shared file output carries, in output order; sync prints them on stderr. */
export function repairLines(outputs: readonly Output[]): string[] {
  return outputs.flatMap((output) =>
    output.kind === "file" ? (output.repairs ?? []).map((repair) => `${output.path}: ${repair}`) : [],
  );
}

/**
 * The prune candidates under `root`, deduped and sorted, split in two: a file holding a region sync wrote (a hashed
 * marker or the legacy pair) is a shared file to `cut`; a file or link with no marker-shaped line is owned and goes
 * in `remove`. A file whose only marker-shaped lines sync did not write, a real dir and a missing path are in neither.
 */
export function splitPrune(root: string, candidates: Iterable<string>): { cut: Cut[]; remove: string[] } {
  const cut: Cut[] = [];
  const remove: string[] = [];
  for (const rel of [...new Set(candidates)].sort()) {
    const stat = fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false });
    if (stat === undefined || stat.isDirectory()) continue;
    const text = stat.isFile() ? fs.readFileSync(path.join(root, rel), "utf8") : null;
    const result = text === null ? null : cutRegions(text, syntaxOf(rel));
    if (result !== null && result.repairs.length > 0) cut.push({ path: rel, ...result });
    // Marker-shaped lines sync did not write are the user's: such a file is neither cut nor removed.
    else if (text === null || !hasMarkers(text, syntaxOf(rel))) remove.push(rel);
  }
  return { cut, remove };
}

/** The `--check` line for each shared file whose regions sync would cut. */
export function cutDriftLines(cut: readonly Cut[]): string[] {
  return cut.map((entry) => `${entry.path} has regions no output writes; run \`bun repo sync\``);
}

/**
 * Writes each cut file's text as sync writes a block file (`writeOutput`, a test seam, when given), or removes it
 * when only whitespace is left, as it held nothing of the user's. `lines` names each region cut and each file
 * removed; `errors` each file that could not be written.
 */
export function applyCuts(root: string, cut: readonly Cut[], write: CutWrite): { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  for (const entry of cut) {
    const blank = entry.text.trim() === "";
    const output: Output = { kind: "file", path: entry.path, content: entry.text, tracked: true, managed: "block" };
    const error = blank
      ? removeFile(path.join(root, entry.path))
      : (write.writeOutput ?? writeOutput)(root, output, write.platform);
    if (error !== null) {
      errors.push(`${entry.path}: could not cut: ${error}`);
      continue;
    }
    lines.push(...entry.repairs.map((repair) => `${repair} from ${entry.path}`));
    if (blank) lines.push(`removed ${entry.path}: nothing but its regions was in it`);
  }
  return { lines, errors };
}

/** Removes the file at `abs`, made writable first; null on success, else the error text. */
function removeFile(abs: string): string | null {
  try {
    unlock(abs);
    fs.rmSync(abs);
    return null;
  } catch (error) {
    return String(error);
  }
}
