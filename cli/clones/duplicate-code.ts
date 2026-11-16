/**
 * `repo/duplicate-code`: each side of every clone jscpd finds over the checkout's JS and TS sources (50 tokens and 5
 * code lines at least, a blank line not counted) as a lint diagnostic in its file, naming the other side. jscpd scans a
 * temp copy of the sources, so every clone's sides are named relative to one root, and the files outside the
 * checkout's listing are never read. The lines of an import declaration, or a re-export from a module, don't count.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Program } from "oxc-parser";
import { z } from "zod";

import { sourceOf } from "../env-syntax.ts";
import { childEnv } from "../env.ts";
import { FIXTURES_DIR } from "../fixtures.constants.ts";
import { GENERATED_DIR } from "../generated.constants.ts";
import { readJson } from "../json.ts";
import { removeTree } from "../remove-tree.ts";
import type { Result } from "../result.ts";
import { codeOf, DUPLICATE_CODE } from "../script-rules.ts";
import type { Diagnostic } from "../scripts/lint-baseline.ts";
import { toolEnv } from "../scripts/tool-env.ts";
import { jscpdBin, type Target } from "./jscpd-bin.ts";

/** The files whose clone sides are reported, and every source scanned for their other sides (root-relative POSIX). */
export type CloneScope = { files: readonly string[]; sources: readonly string[] };

const MIN_TOKENS = 50;
const MIN_LINES = 5;
const FORMATS = "javascript,jsx,typescript,tsx";
const TEMP_PREFIX = "workerstack-clones-";
const REPORT = "jscpd-report.json";
const FIX = "move the shared code into one function both call";
const SOURCE = /\.(?:[jt]sx?|[cm][jt]s)$/;
const REJECT_FILE = /\.reject\.tsx?$/;

/** One side of a clone in jscpd's json report: its lines, and the column it starts at (zero-based). */
type Side = { name: string; start: number; end: number; startLoc: { column: number } };

type Report = { duplicates: { firstFile: Side; secondFile: Side; tokens: number }[] };

/** The part of jscpd's json report read here. */
function reportSchema(): z.ZodType<Report> {
  const side = z.object({
    end: z.number(),
    name: z.string(),
    start: z.number(),
    startLoc: z.object({ column: z.number() }),
  });

  return z.object({ duplicates: z.array(z.object({ firstFile: side, secondFile: side, tokens: z.number() })) });
}

/** One side of a clone, its other side and the tokens they share. */
type Pairing = { own: Side; other: Side; tokens: number };

/** File order, then line and column. */
function byPlace(a: Pairing, b: Pairing): number {
  const byFile = Number(a.own.name > b.own.name) - Number(a.own.name < b.own.name);

  if (byFile !== 0) return byFile;

  return a.own.start === b.own.start ? a.own.startLoc.column - b.own.startLoc.column : a.own.start - b.own.start;
}

/**
 * A JS or TS source jscpd scans: not a reject file, whose errors are its point, nor under a fixtures dir or a `_gen`
 * one, whose generator repeats itself by design.
 */
function isScanned(rel: string): boolean {
  const dirs = rel.split("/");

  return SOURCE.test(rel) && !REJECT_FILE.test(rel) && !dirs.includes(FIXTURES_DIR) && !dirs.includes(GENERATED_DIR);
}

/** `side` named by a POSIX path, as jscpd names it by a native one. */
function posix(side: Side): Side {
  return { ...side, name: side.name.split(path.sep).join("/") };
}

/** A file's lines, and the 1-based numbers of those its import declarations span. */
type FileLines = { text: string[]; imports: ReadonlySet<number> };

/** The lines of each file under `root` by its root-relative name, read and parsed once per file. */
type Lines = { root: string; byFile: Map<string, FileLines> };

/** True for a top-level import, a re-export from a module, an export-all or an import-equals declaration. */
function isImportLike(statement: Program["body"][number]): boolean {
  if (statement.type === "ExportNamedDeclaration") return statement.source !== null;

  return (
    statement.type === "ImportDeclaration" ||
    statement.type === "ExportAllDeclaration" ||
    statement.type === "TSImportEqualsDeclaration"
  );
}

/** The 1-based line `offset` falls on in `text`. */
function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** The 1-based lines from the one `start` falls on through the one `end` does in `text`. */
function spanLines(text: string, start: number, end: number): number[] {
  const first = lineAt(text, start);

  return Array.from({ length: lineAt(text, end) - first + 1 }, (_, i) => first + i);
}

/** The 1-based lines the import declarations of `text`, parsed as `name`, span; none when it does not parse. */
function importLines(name: string, text: string): Set<number> {
  const source = sourceOf(name, text);

  if (source.isBroken) return new Set();

  return new Set(source.program.body.filter(isImportLike).flatMap(({ start, end }) => spanLines(text, start, end)));
}

/** `name`'s lines under `lines.root` with its import lines, read and parsed on the first ask. */
function fileLines(lines: Lines, name: string): FileLines {
  let file = lines.byFile.get(name);

  if (file === undefined) {
    const text = fs.readFileSync(path.join(lines.root, name), "utf8");

    file = { imports: importLines(name, text), text: text.split("\n") };
    lines.byFile.set(name, file);
  }

  return file;
}

/**
 * `side`'s span as jscpd measures one, its end line less its start line, with the lines that hold only whitespace and
 * those of an import declaration left out: the lines past its first that hold code.
 */
function codeSpan(lines: Lines, side: Side): number {
  const { imports, text } = fileLines(lines, side.name);

  const span = text.slice(side.start, side.end);

  return span.filter((line, i) => line.trim() !== "" && !imports.has(side.start + i + 1)).length;
}

/** The diagnostic of the clone side `own`, in its file, naming the side `other`. */
function sideDiagnostic({ own, other, tokens }: Pairing): Diagnostic {
  const rule = codeOf(DUPLICATE_CODE);
  const message = `lines ${own.start}-${own.end} repeat ${other.name}:${other.start}-${other.end} (${tokens} tokens)`;

  return {
    file: own.name,
    line: `${own.name}:${own.start}:${own.startLoc.column + 1}: error ${rule}: ${message}; ${FIX}`,
    rule,
  };
}

/** Copies `sources` that exist under `root` into `dir`, at their own relative paths. */
function copySources(root: string, sources: readonly string[], dir: string): void {
  for (const rel of sources) {
    const from = path.join(root, rel);

    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(dir, rel));
  }
}

/**
 * jscpd's clones over the copy of `sources`, its paths POSIX ones relative to the copy. The copy's dir is made even
 * when no source is left on the disk, which jscpd scans to an empty report. jscpd writes its report whatever it scans,
 * so one missing or unlike its shape is a broken install, thrown.
 */
function scan(bin: string, root: string, sources: readonly string[]): Report {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const copy = path.join(temp, "src");
  const out = path.join(temp, "out");

  try {
    fs.mkdirSync(copy);
    copySources(root, sources, copy);
    const args = ["-k", `${MIN_TOKENS}`, "-l", `${MIN_LINES}`, "-f", FORMATS, "-r", "json", "-o", out];
    spawnSync(bin, [...args, "--no-gitignore", "--silent", "--no-tips", "."], {
      cwd: copy,
      env: toolEnv(childEnv()),
      stdio: "ignore",
    });

    return readJson(reportSchema(), fs.readFileSync(path.join(out, REPORT), "utf8"));
  } finally {
    removeTree(temp);
  }
}

/**
 * Each side in `scope.files` of every clone jscpd finds over `scope.sources` (the JS and TS ones outside fixtures dirs)
 * as a diagnostic in its file, naming the other side; a clone within one file gives two there, and one either side of
 * which spans fewer than 5 code lines none, so blank lines and import declaration lines never make a clone. No jscpd
 * run when no source is left. Or why it could not run: the binary for `target` (this host by default) missing.
 */
export function duplicateDiagnostics(root: string, scope: CloneScope, target?: Target): Result<Diagnostic[]> {
  const sources = scope.sources.filter(isScanned);

  if (sources.length === 0) return { ok: true, value: [] };
  const bin = jscpdBin(target);

  if (!bin.ok) return { error: [bin.error], ok: false };
  const found = scan(bin.path, root, sources);
  const checked = new Set(scope.files.filter(isScanned));

  const lines: Lines = { byFile: new Map(), root };

  const sides = found.duplicates.flatMap(({ firstFile, secondFile, tokens }): Pairing[] => {
    const [first, second] = [posix(firstFile), posix(secondFile)];

    if (codeSpan(lines, first) < MIN_LINES || codeSpan(lines, second) < MIN_LINES) return [];

    return [
      { other: second, own: first, tokens },
      { other: first, own: second, tokens },
    ];
  });

  const value = sides
    .filter(({ own }) => checked.has(own.name))
    .toSorted(byPlace)
    .map(sideDiagnostic);

  return { ok: true, value };
}
