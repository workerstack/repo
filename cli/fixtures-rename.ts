import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fixtureFolders, type FixtureFolder } from "./check-fixtures.ts";
import { FIX_FLAG, FIXTURES_DIR, REWRITE_EXCLUDED_PATHS, USAGE_EXIT } from "./fixtures.constants.ts";
import { listFiles } from "./list-files.ts";

const USAGE = `usage: repo fixtures [${FIX_FLAG}]`;
const NONE = "no fixture folders to rename";
const ROOT = "";
/** What precedes a quoted call argument: `(` or `,`, then the quoted segments before it (group 1). */
const ARGUMENT_LEAD = "(?<=[(,]\\s*)((?:[\"'][\\w.@-]+[\"']\\s*,\\s*)*)";
/** What follows a call argument. */
const ARGUMENT_END = "(?=\\s*[,)])";
/** One quoted segment of a call's argument list, its text in group 1. */
const SEGMENT = /["']([\w.@-]+)["']/g;

type Plan = { readonly files: Set<string>; readonly folder: FixtureFolder; refs: number; readonly skipped: boolean };

/**
 * `rel`'s content when it is a writable UTF-8 text file, else null: a read-only file is sync's, rewritten from its
 * source.
 */
function readText(cwd: string, rel: string): string | null {
  try {
    const file = path.join(cwd, rel);
    fs.accessSync(file, fs.constants.W_OK);
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/** The folder of `rel`, `` for the root. */
function parentOf(rel: string): string {
  const dir = path.posix.dirname(rel);
  return dir === "." ? ROOT : dir;
}

/** Whether one of the posix `targets` is the folder `parent` (`""` for the root). */
function reaches(targets: readonly string[], parent: string): boolean {
  return targets.some((target) => (target === "." ? ROOT : target) === parent);
}

/** `text` of the file at `rel` with the references to `folder` pointed at its new name, and how many changed. */
function rewrite(text: string, rel: string, folder: FixtureFolder): { refs: number; text: string } {
  const parent = parentOf(folder.from);
  const name = path.posix.basename(folder.from);
  const dir = parentOf(rel);
  let refs = 0;
  const pathRef = new RegExp(String.raw`(?<![\w.@~/-])((?:\.{1,2}/)*)((?:[\w.@-]+/)*?)${RegExp.escape(name)}/`, "g");
  let out = text.replaceAll(pathRef, (match, dots: string, mid: string) => {
    const midDir = path.posix.join(mid, ".");
    // A bare path (`cli/x/fixtures/`, `fixtures/`) may be root-relative or file-relative; a dotted one is the file's.
    const targets = dots === ROOT ? [midDir, path.posix.join(dir, midDir)] : [path.posix.join(dir, dots, midDir)];
    if (!reaches(targets, parent)) return match;
    refs += 1;
    return `${dots}${mid}${FIXTURES_DIR}/`;
  });
  // A quoted call argument (`path.join(dir, "fixtures")`, `path.join(root, "cli", "fixtures")`) whose quoted segments
  // before it lead to the parent from the root or from the file's folder; a command name or union member stays.
  const argument = new RegExp(`${ARGUMENT_LEAD}(["'])${RegExp.escape(name)}\\2${ARGUMENT_END}`, "g");
  out = out.replaceAll(argument, (match, segments: string, quote: string) => {
    const lead = [...segments.matchAll(SEGMENT)].map((segment) => segment[1]).join("/");
    // An argument with no segments before it is relative to the file alone, so a root folder is no wildcard.
    const targets = lead === ROOT ? [dir] : [path.posix.join(lead, "."), path.posix.join(dir, lead, ".")];
    if (!reaches(targets, parent)) return match;
    refs += 1;
    return `${segments}${quote}${FIXTURES_DIR}${quote}`;
  });
  return { refs, text: out };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function counts(refs: number, files: number): string {
  return `${plural(refs, "reference")} in ${plural(files, "file")}`;
}

/** A plan per folder; one whose new name is taken, on disk or by an earlier folder, is skipped. */
function planFolders(cwd: string, folders: readonly FixtureFolder[]): Plan[] {
  const taken = new Set<string>();
  return folders.map((folder) => {
    const skipped = taken.has(folder.to) || fs.existsSync(path.join(cwd, folder.to));
    taken.add(folder.to);
    return { files: new Set(), folder, refs: 0, skipped };
  });
}

/** The new content of every tracked text file the rewrite changes; counts land on `plans`. */
function collectEdits(cwd: string, plans: readonly Plan[]): Map<string, string> {
  const edits = new Map<string, string>();
  for (const rel of listFiles(cwd, [])) {
    const original = REWRITE_EXCLUDED_PATHS.includes(rel) ? null : readText(cwd, rel);
    if (original === null) continue;
    let text = original;
    for (const plan of plans) {
      const next = rewrite(text, rel, plan.folder);
      if (next.refs === 0) continue;
      text = next.text;
      plan.refs += next.refs;
      plan.files.add(rel);
    }
    if (text !== original) edits.set(rel, text);
  }
  return edits;
}

/**
 * Lists the fixture folders to rename (`fix: false`), or renames each with `git mv` and rewrites the path
 * references to it in tracked text files. Returns the lines to print.
 */
export function renameFixtures(cwd: string, { fix }: { fix: boolean }): string[] {
  const folders = fixtureFolders(listFiles(cwd));
  if (folders.length === 0) return [NONE];
  const plans = planFolders(cwd, folders);
  const active = plans.filter((plan) => !plan.skipped);
  const edits = collectEdits(cwd, active);
  const skipped = plans
    .filter((plan) => plan.skipped)
    .map(({ folder }) => `${folder.from} -> ${folder.to} (skipped: ${folder.to} exists)`);
  if (!fix) {
    const planned = active.map(
      ({ files, folder, refs }) => `${folder.from} -> ${folder.to} (${counts(refs, files.size)})`,
    );
    return [...planned, ...skipped];
  }
  for (const [rel, text] of edits) fs.writeFileSync(path.join(cwd, rel), text);
  for (const { folder } of active) execFileSync("git", ["mv", folder.from, folder.to], { cwd, stdio: "ignore" });
  const refs = active.reduce((sum, plan) => sum + plan.refs, 0);
  return [`renamed ${plural(active.length, "folder")}, rewrote ${counts(refs, edits.size)}`, ...skipped];
}

/** `repo fixtures [--fix]`: prints the plan, or applies it with `--fix`. */
export function main(argv: string[]): number {
  if (argv.some((arg) => arg !== FIX_FLAG)) {
    process.stderr.write(`${USAGE}\n`);
    return USAGE_EXIT;
  }
  const lines = renameFixtures(process.cwd(), { fix: argv.includes(FIX_FLAG) });
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  return 0;
}
