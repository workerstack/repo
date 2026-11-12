#!/usr/bin/env bun
/**
 * Machine-local live agent board. One JSON file per session under ~/.workerstack/board/.
 * A read prints lines whose host process is still alive and deletes the rest.
 * Fail-open: a probe or IO error skips the write and prints nothing.
 */
import fs from "node:fs";
import path from "node:path";

import { atomicWrite, boardDir, boardHome, ensureDir, readRow, rowPath } from "./board-files.ts";
import { field, formatLine, isTruthy, oneLine, orNone, str, valueOrNone, workLabel } from "./board-line.ts";
import { probeProcess, readBootId, rowAlive } from "./board-process.ts";
import { ACTIVE, DEFAULT_SESSION, DIGEST_CAP, MILLIS_RE, ROW_EXT } from "./board.constants.ts";
import type { BoardRow, DigestOptions, NoteOptions, SweepOptions } from "./board.types.ts";

/** A row's work label and whether a set `--work` pins it. */
type Work = { work: string; sticky: boolean };

/** The rows whose process is alive, oldest first; every other row file is deleted. */
export function sweep({ home, boot, probe = probeProcess }: SweepOptions): BoardRow[] {
  const dir = boardDir(home);

  if (!fs.existsSync(dir)) return [];
  const kept: BoardRow[] = [];

  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);

    if (!name.endsWith(ROW_EXT)) continue;
    const row = readRow(file);

    if (row === null || !rowAlive(row, { boot, probe })) {
      fs.rmSync(file, { force: true });
      continue;
    }

    kept.push(row);
  }

  return kept.toSorted((a, b) => a.time.localeCompare(b.time));
}

function nextWork(prev: BoardRow | null, opts: NoteOptions): Work {
  const label = workLabel(opts.work);

  if (opts.forceWork === true) return { sticky: true, work: orNone(label) };

  if (prev?.sticky === true && prev.work !== "") return { sticky: true, work: prev.work };

  if (label !== "") return { sticky: false, work: label };

  if (prev !== null && prev.work !== "") return { sticky: false, work: prev.work };

  return { sticky: false, work: ACTIVE };
}

function isoTime(date: Date): string {
  return date.toISOString().replace(MILLIS_RE, "Z");
}

function stamp(now: NoteOptions["now"]): string {
  if (now instanceof Date) return isoTime(now);

  return isTruthy(now) ? String(now) : isoTime(new Date());
}

function hasProcess(opts: NoteOptions): boolean {
  return opts.pid != null && opts.start != null && opts.start !== "";
}

function rowOf(opts: NoteOptions, key: { provider: string; session: string }, work: Work): BoardRow {
  return {
    boot: str(opts.boot),
    cwd: oneLine(opts.cwd),
    effort: valueOrNone(opts.effort),
    model: valueOrNone(opts.model),
    pid: Number(opts.pid),
    provider: key.provider,
    session: key.session,
    start: String(opts.start),
    sticky: work.sticky,
    time: stamp(opts.now),
    work: work.work,
  };
}

/** Writes this session's row, then sweeps; the row, or null when there is no session or it did not survive. */
export function note(opts: NoteOptions = {}): BoardRow | null {
  const session = str(opts.session).trim();

  if (session === "" || session === DEFAULT_SESSION || !hasProcess(opts)) return null;
  const home = opts.home ?? boardHome(opts.env);
  const dir = boardDir(home);
  ensureDir(dir);
  const provider = field(opts.provider);
  const file = rowPath(dir, provider, session);
  const row = rowOf(opts, { provider, session }, nextWork(readRow(file), opts));
  atomicWrite(file, `${JSON.stringify(row)}\n`);
  sweep({ boot: row.boot, home, probe: opts.probe });

  return fs.existsSync(file) ? row : null;
}

export function lines(opts: DigestOptions = {}): string[] {
  const home = opts.home ?? boardHome(opts.env);
  const boot = opts.boot ?? readBootId();

  return sweep({ boot, home, probe: opts.probe }).map(formatLine);
}

/** The other sessions' lines, newest first, capped. */
export function digest(opts: DigestOptions = {}): string {
  const home = opts.home ?? boardHome(opts.env);
  const boot = opts.boot ?? readBootId();
  const selfP = field(opts.provider);
  const selfS = field(opts.session);

  return sweep({ boot, home, probe: opts.probe })
    .filter((row) => !(field(row.provider) === selfP && field(row.session) === selfS))
    .toSorted((a, b) => b.time.localeCompare(a.time))
    .slice(0, opts.cap ?? DIGEST_CAP)
    .map(formatLine)
    .join("\n");
}
