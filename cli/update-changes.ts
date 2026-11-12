import fs from "node:fs";
import path from "node:path";

import { matchesName } from "./matches-name.ts";
import { compareVersions, parseChangelog } from "./release/changelog-parse.ts";
import { parseSemver } from "./release/version.ts";
import {
  CHANGELOG_FILE,
  CHANGES_SCOPE,
  INDENT,
  MODULES_DIR,
  POSIX,
  ROOT_FILE,
  changesHeader,
  noChangelog,
  noSections,
} from "./update.constants.ts";
import type { Checked } from "./update.types.ts";

/** A package that moves: the dirs of its bumped manifests, the lowest spec version and the version it moves to. */
type Moving = { dirs: string[]; low: string; to: string };

/** A package that moves, with where it is installed and the version the range starts above. */
type Bump = { name: string; dir: string; from: string; to: string };

const NAME_SEPARATOR = "/";

function packageDir(dir: string, name: string): string {
  return path.join(dir, MODULES_DIR, ...name.split(NAME_SEPARATOR));
}

/** Positive when `x` is the newer semver version, negative when `y` is, 0 when equal; NaN when either is not semver. */
function compared(x: string, y: string): number {
  const first = parseSemver(x);
  const second = parseSemver(y);

  return first === null || second === null ? Number.NaN : compareVersions(first, second);
}

/** The `version` of an installed package.json; null when the file is unreadable or names no semver version. */
function installedVersion(dir: string, name: string): string | null {
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(packageDir(dir, name), ROOT_FILE), "utf8"));

    const version = (manifest /* parsed JSON, read as an object only after the check */ as { version?: unknown })
      .version;

    return typeof version === "string" && parseSemver(version) !== null ? version : null;
  } catch {
    return null;
  }
}

/**
 * Where a name is installed (the first bumped source's dir that holds it, else the root) and the version the range
 * starts above.
 */
function bumpOf(root: string, name: string, moving: Moving): Bump {
  const dir = moving.dirs.find((one) => fs.existsSync(path.join(packageDir(one, name), ROOT_FILE))) ?? root;

  return { dir, from: installedVersion(dir, name) ?? moving.low, name, to: moving.to };
}

/** The sections of a changelog above `from` up to `to`, in file order, blank lines dropped and every line indented. */
function sectionLines(text: string, from: string, to: string): string[] {
  return parseChangelog(text)
    .sections.filter(({ version }) => version !== null && compared(version, from) > 0 && compared(version, to) <= 0)
    .flatMap(({ heading, body }) =>
      [heading, ...body].filter((line) => line.trim() !== "").map((line) => `${INDENT}${line}`),
    );
}

/** One bump's lines, read from the changelog it installed. */
function blockOf(root: string, { name, dir, from, to }: Bump): string[] {
  const home = packageDir(dir, name);
  const file = path.join(home, CHANGELOG_FILE);
  const header = changesHeader(name, from, to);

  if (!fs.existsSync(file)) return [noChangelog(header, path.relative(root, home).split(path.sep).join(POSIX))];
  const lines = sectionLines(fs.readFileSync(file, "utf8"), from, to);

  return lines.length === 0 ? [noSections(header)] : [header, ...lines];
}

/**
 * Reads the installed version of each bumped `@workerstack/*` name now, before the install replaces it,
 * and returns what prints once it has: per name the CHANGELOG sections above that version up to the new one.
 */
export function updateChanges(root: string, behind: readonly Checked[]): () => string[] {
  const moving = new Map<string, Moving>();

  for (const source of behind) {
    if (!matchesName(CHANGES_SCOPE, source.name)) continue;
    const dir = path.dirname(path.join(root, ...source.file.split(POSIX)));
    const seen = moving.get(source.name);

    if (seen === undefined) {
      moving.set(source.name, { dirs: [dir], low: source.version, to: source.latest });
    } else {
      seen.dirs.push(dir);

      if (compared(source.version, seen.low) < 0) seen.low = source.version;
    }
  }

  const bumps = [...moving].map(([name, one]) => bumpOf(root, name, one));

  return () => bumps.flatMap((bump) => blockOf(root, bump));
}
