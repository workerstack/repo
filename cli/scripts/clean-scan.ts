/** What `repo clean` reads from disk: listings, ages, sizes, statuses, roadmap pins and nested ignored `.repo` dirs. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { IGNORED_DIRS, REPO } from "../repo-dirs.ts";
import {
  DONE_STATUS,
  DURABLE,
  FRONTMATTER_RE,
  GIT_MAX_BUFFER,
  LAST_SEG,
  LOCATION_RE,
  MD_EXT,
  NESTED_DIR_SEGS,
  NESTED_REPO_SEGS,
  NO_SERIAL,
  PARENT_SEG,
  ROADMAPS_DIR,
  ROADMAPS_FAST_DIR,
  SERIAL_RE,
  STATUS_RE,
  TRAILING_SLASHES_RE,
} from "./clean.constants.ts";

/** The names in `dir`, or none when it cannot be read. */
export function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Newest mtime anywhere inside; a symlink counts by its own mtime and is never followed. */
export function newest(p: string): number {
  const st = fs.lstatSync(p);
  let t = st.mtimeMs;

  if (st.isDirectory()) for (const name of list(p)) t = Math.max(t, newest(path.join(p, name)));

  return t;
}

/** The bytes under a path and whether it is a dir. */
export type PathStats = { bytes: number; dir: boolean };

/** The bytes under `p` and whether it is a dir; a symlink counts by its own size. */
export function stats(p: string): PathStats {
  const st = fs.lstatSync(p);

  if (!st.isDirectory()) return { bytes: st.size, dir: false };
  let bytes = 0;

  for (const name of list(p)) bytes += stats(path.join(p, name)).bytes;

  return { bytes, dir: true };
}

function holdsFile(p: string): boolean {
  if (!fs.lstatSync(p).isDirectory()) return true;

  return list(p).some((name) => holdsFile(path.join(p, name)));
}

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.some((dir) => dir === name);
}

/** The nested ignored `.repo` dirs one git ignored-dir entry names, else none; the root's own `.repo` never counts. */
function nestedRels(entry: string, root: string): string[] {
  const segs = entry.replace(TRAILING_SLASHES_RE, "").split("/");
  const last = segs.at(LAST_SEG) /* split yields at least one element */ as string;

  if (segs.length >= NESTED_DIR_SEGS && segs.at(PARENT_SEG) === REPO && isIgnored(last)) return [segs.join("/")];

  // a nested `.repo` ignored whole: each ignored dir it holds
  if (segs.length >= NESTED_REPO_SEGS && last === REPO) {
    return list(path.join(root, ...segs))
      .filter((n) => isIgnored(n))
      .map((n) => [...segs, n].join("/"));
  }

  return [];
}

function isDir(abs: string): boolean {
  let isDirectory = false;

  try {
    isDirectory = fs.lstatSync(abs).isDirectory();
  } catch {
    // the ignored entry is gone or a file
  }

  return isDirectory;
}

/** Nested ignored `.repo` dirs below the root, from git's ignored-dir listing; [] outside git. */
export function nestedRepoDirs(root: string): string[] {
  const r = spawnSync("git", ["ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
  });

  if (r.status !== 0) return [];
  const out = new Set<string>();

  for (const entry of r.stdout.split("\0")) {
    for (const rel of nestedRels(entry, root)) {
      const abs = path.join(root, rel);

      if (isDir(abs)) out.add(abs);
    }
  }

  return [...out];
}

/** The serial `name` starts with, else null. */
export function leadingSerial(name: string): number | null {
  const m = SERIAL_RE.exec(name);

  return m === null ? null : Number(m[1]);
}

/**
 * The serial a dir's counter sees in `name`, else null: `nextSerial` counts `.md` only, the roadmap counter any
 * name.
 */
export function serialOf(dir: string, name: string): number | null {
  if (dir !== ROADMAPS_DIR && dir !== ROADMAPS_FAST_DIR && !name.endsWith(MD_EXT)) return null;

  return leadingSerial(name);
}

/** The frontmatter `status:` of `file`, else null. */
export function statusOf(file: string): string | null {
  try {
    const m = FRONTMATTER_RE.exec(fs.readFileSync(file, "utf8"));
    const s = m?.[1] === undefined ? null : STATUS_RE.exec(m[1]);

    return s?.[1] ?? null;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Resolved `Location:` paths named by every roadmap under `repo` (a `.repo` dir) that is not `done`. */
export function roadmapLocations(repo: string): Set<string> {
  const out = new Set<string>();

  for (const dir of [ROADMAPS_DIR, ROADMAPS_FAST_DIR]) {
    for (const name of list(path.join(repo, dir))) {
      const file = path.join(repo, dir, name);

      if (statusOf(file) === DONE_STATUS) continue;
      const text = readText(file);

      if (text === null) continue;

      for (const m of text.matchAll(LOCATION_RE)) out.add(path.resolve(String(m[1]))); // group 1 is unconditional
    }
  }

  return out;
}

/** The name with the highest serial under `pick`, so max + 1 counters never hand out a number again. */
export function keeperOf(names: string[], pick: (name: string) => number | null): string | null {
  let best: string | null = null;
  let top = NO_SERIAL;

  for (const n of names) {
    const s = pick(n);

    if (s !== null && s > top) [best, top] = [n, s];
  }

  return best;
}

/**
 * The durable dir name (`plans`, `roadmaps`, ...) when the ignored `.repo` dir `dir` is one holding a file, else
 * null.
 */
export function nestedHolds(dir: string): string | null {
  const name = path.basename(dir);

  return DURABLE.includes(name) && holdsFile(dir) ? name : null;
}
