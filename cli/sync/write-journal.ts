// The journal `writeAll` keeps of every path it touches, and the undo that puts each one back.
import fs from "node:fs";
import path from "node:path";

import { unlock } from "./write-modes.ts";
import { PERMISSION_BITS } from "./write.constants.ts";

/** What sat at a path before sync touched it. A `dir` is never replaced, so it needs no restoring. */
type Prior =
  | { kind: "absent" }
  | { kind: "dir" }
  | { kind: "file"; bytes: Buffer; mode: number }
  | { kind: "link"; target: string };

/** One touched path: its prior state, the dirs the step created above it, and whether the step finished. */
export type JournalEntry = { abs: string; prior: Prior; created: string[]; done: boolean; counted: boolean };

/** One step to journal: the path it touches, whether it counts as an output, the dirs it creates and its action. */
export type Step = { abs: string; counted: boolean; created: string[]; run: () => string | null };

/** Whether anything, a dangling link included, is at `abs`; a path below a file is not. */
function isPresent(abs: string): boolean {
  try {
    fs.lstatSync(abs);

    return true;
  } catch {
    return false;
  }
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

/**
 * Records the step's path's prior state in `journal`, then runs the step; its error text, or null. A path that cannot
 * be recorded is not touched.
 */
export function journalStep(journal: JournalEntry[], step: Step): string | null {
  const { abs, counted, created, run } = step;
  let prior: Prior;

  try {
    prior = capture(abs);
  } catch (error) {
    return (error /* fs throws an Error */ as Error).message;
  }

  const entry: JournalEntry = { abs, counted, created, done: false, prior };
  journal.push(entry);
  const error = run();
  entry.done = error === null;

  return error;
}

function restorePath({ abs, prior }: JournalEntry): void {
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

/** Puts every journaled path back, newest first, and returns `message` with what happened. */
export function undoJournal(root: string, journal: readonly JournalEntry[], message: string): string {
  const stuck: string[] = [];

  function attempt(abs: string, action: () => void): void {
    try {
      action();
    } catch {
      stuck.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  }

  for (const entry of journal.toReversed()) {
    attempt(entry.abs, () => restorePath(entry));

    for (const dir of entry.created.toReversed()) attempt(dir, () => fs.existsSync(dir) && fs.rmdirSync(dir));
  }

  if (stuck.length > 0) return `${message}; could not restore ${stuck.join(", ")}; run \`bun repo sync\` again`;
  const count = journal.filter((entry) => entry.done && entry.counted).length;

  return `${message}; restored ${count} output${count === 1 ? "" : "s"}, nothing changed`;
}
