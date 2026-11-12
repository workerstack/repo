/** The generated lessons index: its rows, its text, and its one writer. */
import fs from "node:fs";
import path from "node:path";

import { stamp } from "../sync/header.ts";
import { OWNED_MODE } from "../sync/write.constants.ts";
import { writeOwned } from "../sync/write.ts";
import { parseLesson } from "./lesson-file.ts";
import {
  CELL_SEP,
  ESCAPED_PIPE,
  INDEX_CELLS,
  INDEX_NAME,
  LESSONS_DIR,
  MD_EXT,
  NUL,
  PATHS_SEP,
  PIPE,
  ROW_EDGE,
  ROW_PREFIX,
  SPACES_RE,
} from "./lessons.constants.ts";
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

function cell(s: string): string {
  return s.replaceAll(SPACES_RE, " ").replaceAll(PIPE, ESCAPED_PIPE);
}

/** One row per valid lesson file, and per `pending` text the host is about to write. */
function indexRows(ws: string, pending: Record<string, string> = {}): IndexRow[] {
  const names = [...new Set([...lessonFiles(ws), ...Object.keys(pending)])].toSorted();

  const rows = names.flatMap((name): IndexRow[] => {
    const parsed = parseLesson(pending[name] ?? fs.readFileSync(path.join(lessonsDir(ws), name), "utf8"));

    if (!parsed.ok) return [];
    const l = parsed.lesson;

    return [{ file: `${LESSONS_DIR}/${name}`, hits: l.hits, lastHit: l.lastHit, paths: l.paths, summary: l.summary }];
  });

  return rows.toSorted(byHitsThenFile);
}

/** The index text, under sync's header line and a blank line, so every writer of it writes the same bytes. */
function renderIndex(rows: IndexRow[]): string {
  const body = rows.map(
    (r) => `| ${r.file} | ${cell(r.paths.join(PATHS_SEP))} | ${r.hits} | ${r.lastHit} | ${cell(r.summary)} |`,
  );

  const text = [
    "",
    "# Lessons",
    "",
    "| lesson | paths | hits | last-hit | summary |",
    "| --- | --- | --- | --- | --- |",
    ...body,
    "",
  ].join("\n");

  return stamp(`${LESSONS_DIR}/${INDEX_NAME}`, text);
}

/** The rows of an index text; a line that is not a five-cell lesson row is skipped. */
export function parseIndex(text: string): IndexRow[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith(ROW_PREFIX))
    .flatMap((line): IndexRow[] => {
      const cells = line
        .slice(ROW_EDGE, -ROW_EDGE)
        .replaceAll(ESCAPED_PIPE, NUL)
        .split(CELL_SEP)
        .map((c) => c.replaceAll(NUL, PIPE));

      if (cells.length !== INDEX_CELLS) return [];

      const [file, pathsCell, hits, lastHit, summary] = cells /* five cells checked above */ as [
        string,
        string,
        string,
        string,
        string,
      ];

      return [{ file, hits: Number(hits), lastHit, paths: pathsCell.split(PATHS_SEP).filter(Boolean), summary }];
    });
}

/**
 * Derived from the lesson files only, so any writer rerunning it converges; temp file then rename, left read-only
 * as sync leaves the files it owns. Throws, naming the index, when it cannot be written.
 */
export function writeIndex({ workspaceRoot: ws, pending }: IndexInput): { ok: boolean; path: string } {
  const dir = lessonsDir(ws);
  fs.mkdirSync(dir, { recursive: true });
  const text = renderIndex(indexRows(ws, pending));
  const dest = path.join(dir, INDEX_NAME);
  const error = writeOwned(dest, text, OWNED_MODE);

  if (error !== null) throw new Error(`cannot write ${dest}: ${error}`);

  return { ok: true, path: dest };
}

/** The text of the lessons index for the lesson files under `ws`. */
export function renderLessonsIndex(ws: string): string {
  return renderIndex(indexRows(ws));
}
