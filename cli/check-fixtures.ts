import path from "node:path";

import { FIXTURE_LIKE_NAMES, FIXTURES_DIR, NOT_FOUND, UNSCANNED_DIRS } from "./fixtures.constants.ts";
import { listFiles } from "./list-files.ts";

/** A fixture folder and where it goes, both posix and relative to the root. */
export type FixtureFolder = { readonly from: string; readonly to: string };

/** The outermost fixture-like folder above `rel`, or null when it sits under `__fixtures__` or a vendored folder. */
function folderOf(rel: string): FixtureFolder | null {
  const dirs = path.posix.dirname(rel).split("/");
  if (dirs.some((dir) => dir === FIXTURES_DIR || UNSCANNED_DIRS.includes(dir))) return null;
  const at = dirs.findIndex((dir) => FIXTURE_LIKE_NAMES.includes(dir));
  if (at === NOT_FOUND) return null;
  const parent = dirs.slice(0, at);
  return { from: [...parent, dirs[at]].join("/"), to: [...parent, FIXTURES_DIR].join("/") };
}

/** Every fixture folder holding one of `files`, once each, sorted by path. */
export function fixtureFolders(files: readonly string[]): FixtureFolder[] {
  const found = new Map<string, FixtureFolder>();
  for (const rel of files) {
    const folder = folderOf(rel);
    if (folder !== null) found.set(folder.from, folder);
  }
  return [...found.values()].toSorted((a, b) => a.from.localeCompare(b.from, "en"));
}

/**
 * One line per folder named like fixtures (`fixtures`, `testdata`, ...), sorted: fixtures live in `__fixtures__`.
 * Tracked and untracked non-ignored files count; `__fixtures__` and vendored folders are not looked into.
 */
export function checkFixtures(cwd: string): string[] {
  return fixtureFolders(listFiles(cwd)).map(
    ({ from, to }) => `fixtures: ${from} is a fixture folder; rename it to ${to} (bun repo fixtures --fix)`,
  );
}
