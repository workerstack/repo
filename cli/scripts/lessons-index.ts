/** The generated lessons index: its rows, its text, and its one writer. */
import fs from "node:fs";
import path from "node:path";

import { stamp } from "../sync/header.ts";
import { OWNED_MODE } from "../sync/write.constants.ts";
import { writeOwned } from "../sync/write.ts";
import { parseLesson } from "./lesson-file.ts";
import { INDEX_NAME, LESSONS_DIR, MD_EXT } from "./lessons.constants.ts";
import type { IndexInput, IndexRow } from "./lessons.types.ts";

export function lessonsDir(ws: string): string {
  return path.join(ws, LESSONS_DIR);
}

/** The lesson filenames under `ws`, sorted; [] without a lessons dir. */
export function lessonFiles(ws: string): string[] {
  const dir = lessonsDir(ws);

  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(MD_EXT) && n !== INDEX_NAME)
    .toSorted();
}

/** Most hits first, then by file; rows whose hits are not numbers sort by file. */
export function byHitsThenFile(a: IndexRow, b: IndexRow): number {
  const diff = b.hits - a.hits;

  return diff === 0 || Number.isNaN(diff) ? a.file.localeCompare(b.file) : diff;
}

/** The valid lessons as rows, and the repo-relative paths of the lesson files that do not parse. */
export type LessonsRead = { invalid: string[]; rows: IndexRow[] };

/** Read the lesson files under `ws`, and the `pending` texts the host is about to write. */
export function readLessons(ws: string, pending: Record<string, string> = {}): LessonsRead {
  const names = [...new Set([...lessonFiles(ws), ...Object.keys(pending)])].toSorted();
  const invalid: string[] = [];
  const rows: IndexRow[] = [];

  for (const name of names) {
    const parsed = parseLesson(pending[name] ?? fs.readFileSync(path.join(lessonsDir(ws), name), "utf8"));

    const file = `${LESSONS_DIR}/${name}`;

    if (parsed.ok) {
      const l = parsed.lesson;
      rows.push({ file, hits: l.hits, lastHit: l.lastHit, paths: l.paths, title: l.title });
    } else {
      invalid.push(file);
    }
  }

  return { invalid, rows: rows.toSorted(byHitsThenFile) };
}

/** The index text, under sync's header line and a blank line, so every writer of it writes the same bytes. */
function renderIndex(rows: IndexRow[]): string {
  const body = rows.map((r) => `- \`${path.basename(r.file, MD_EXT)}\` (hits ${r.hits}): ${r.title}`);
  const text = ["", "# Lessons", "", ...body, ""].join("\n");

  return stamp(`${LESSONS_DIR}/${INDEX_NAME}`, text);
}

/** Whether the index was written, and where. */
export type IndexWritten = { ok: boolean; path: string };

/**
 * Derived from the lesson files only, so any writer rerunning it converges; temp file then rename, left read-only
 * as sync leaves the files it owns. Throws, naming the index, when it cannot be written.
 */
export function writeIndex({ workspaceRoot: ws, pending }: IndexInput): IndexWritten {
  const dir = lessonsDir(ws);
  fs.mkdirSync(dir, { recursive: true });
  const text = renderIndex(readLessons(ws, pending).rows);
  const dest = path.join(dir, INDEX_NAME);
  const error = writeOwned(dest, text, OWNED_MODE);

  if (error !== null) throw new Error(`cannot write ${dest}: ${error}`);

  return { ok: true, path: dest };
}

/** The text of the lessons index for the lesson files under `ws`. */
export function renderLessonsIndex(ws: string): string {
  return renderIndex(readLessons(ws).rows);
}
