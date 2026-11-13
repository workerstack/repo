/** Rewrites the old `.tmp/repo/<x>` spellings in text and in the files of a dir to their `.repo` homes. */
import fs from "node:fs";
import path from "node:path";

import { oldTmpHome, REPO } from "../repo-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { isDir, present, same } from "./migrate-fs.ts";
import type { MigrationStep } from "./migrate.ts";
import { arrayRe, pathRe } from "./tmp-repo.constants.ts";

/** Rewrite each `.tmp/repo/<segment>` in `text`, whatever the separator, and each quoted segment array. */
export function mapOldPaths(text: string): string {
  const paths = text.replaceAll(pathRe(), (...match: string[]) => {
    const [, sep, , name] = match /* every group of the regex always captures */ as [string, string, string, string];

    return [REPO, ...oldTmpHome(name).split("/")].join(sep);
  });

  return paths.replaceAll(arrayRe(), (...match: string[]) => {
    const [, quote, , comma, name] = match /* all groups capture */ as [string, string, string, string, string];

    return [REPO, ...oldTmpHome(name).split("/")].map((part) => `${quote}${part}${quote}`).join(comma);
  });
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) return filesUnder(abs);

    return entry.isFile() ? [abs] : [];
  });
}

/** Rewrite the text files under `dir` (or the file itself) in place, binary files alone; the count changed. */
export function rewriteOldPaths(dir: string): number {
  let changed = 0;

  for (const file of isDir(dir) ? filesUnder(dir) : [dir]) {
    const text = fs.readFileSync(file, "utf8");

    if (text.includes("\0")) continue;
    const next = mapOldPaths(text);

    if (next === text) continue;
    fs.writeFileSync(file, next);
    changed += 1;
  }

  return changed;
}

const OLD = ".tmp/repo";

/** `text` as the rewrite leaves it: a file with a NUL byte is binary and stays as it is. */
function mapped(text: string): string {
  return text.includes("\0") ? text : mapOldPaths(text);
}

/**
 * A conflict for each file under `from` whose rewritten text differs from what is at `to`; both are root-relative
 * with `/`.
 */
function conflictsIn(root: string, from: string, to: string): MigrationStep[] {
  const src = path.join(root, from);
  const dst = path.join(root, to);

  if (!present(dst)) return [];

  if (isDir(src) && isDir(dst)) {
    return fs
      .readdirSync(src)
      .toSorted(byCodeUnit)
      .flatMap((name) => conflictsIn(root, `${from}/${name}`, `${to}/${name}`));
  }

  const differs = isDir(src) || isDir(dst) || !same(mapped(fs.readFileSync(src, "utf8")), fs.readFileSync(dst, "utf8"));

  return differs ? [{ from, kind: "conflict", to }] : [];
}

/**
 * The steps that move `.tmp/repo` to `.repo`: one move per entry, each rewriting its old paths first, a conflict for
 * every file whose rewritten text differs from the one at its home, and the removal of the emptied dir.
 */
export function planTmpRepo(root: string): MigrationStep[] {
  const old = path.join(root, OLD);

  if (!isDir(old)) return [];
  const names = fs.readdirSync(old).toSorted(byCodeUnit);

  const entries = names.flatMap((name): MigrationStep[] => {
    const from = `${OLD}/${name}`;
    const to = `${REPO}/${oldTmpHome(name)}`;

    return [...conflictsIn(root, from, to), { from, kind: "move", note: `moved ${from} to ${to}`, relocate: true, to }];
  });

  return [...entries, { kind: "prune", note: "removed the empty .tmp/repo", path: OLD }];
}
