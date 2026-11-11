/** What `repo clean` reads from disk: listings, ages, sizes, statuses, roadmap pins and nested .tmp/repo dirs. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  DONE_STATUS,
  DURABLE,
  FRONTMATTER_RE,
  GIT_MAX_BUFFER,
  LOCATION_RE,
  MD_EXT,
  NO_SERIAL,
  ROADMAPS_DIR,
  SERIAL_RE,
  STATUS_RE,
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

/** The bytes under `p` and whether it is a dir; a symlink counts by its own size. */
export function stats(p: string): { bytes: number; dir: boolean } {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return { bytes: st.size, dir: false };
  let bytes = 0;
  for (const name of list(p)) bytes += stats(path.join(p, name)).bytes;
  return { bytes, dir: true };
}

function holdsFile(p: string): boolean {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return false;
  }
  if (!st.isDirectory()) return true;
  return list(p).some((name) => holdsFile(path.join(p, name)));
}

/** The .tmp/repo dir one git ignored-dir entry names, else null. */
function nestedRel(entry: string): string | null {
  const e = entry.replace(/\/+$/, "");
  if (e.endsWith("/.tmp")) return `${e}/repo`;
  if (e.endsWith("/.tmp/repo")) return e;
  return null;
}

function isDir(abs: string): boolean {
  let dir = false;
  try {
    dir = fs.lstatSync(abs).isDirectory();
  } catch {
    // no repo dir under this .tmp
  }
  return dir;
}

/** Nested .tmp/repo dirs below the root, from git's ignored-dir listing; [] outside git. */
export function nestedTmpDirs(root: string): string[] {
  const r = spawnSync("git", ["ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (r.status !== 0) return [];
  const out = new Set<string>();
  for (const entry of r.stdout.split("\0")) {
    const rel = nestedRel(entry);
    if (rel === null) continue;
    const abs = path.join(root, rel);
    if (isDir(abs)) out.add(abs);
  }
  return [...out];
}

/** The serial `name` starts with, else null. */
export function leadingSerial(name: string): number | null {
  const m = SERIAL_RE.exec(name);
  return m ? Number(m[1]) : null;
}

/** The serial a dir's counter sees in `name`, else null: `nextSerial` counts `.md` only, the roadmap counter any name. */
export function serialOf(dir: string, name: string): number | null {
  if (dir !== ROADMAPS_DIR && !name.endsWith(MD_EXT)) return null;
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

/** Resolved `Location:` paths named by every roadmap that is not `done`. */
export function roadmapLocations(tmp: string): Set<string> {
  const dir = path.join(tmp, ROADMAPS_DIR);
  const out = new Set<string>();
  for (const name of list(dir)) {
    const file = path.join(dir, name);
    if (statusOf(file) === DONE_STATUS) continue;
    const text = readText(file);
    if (text === null) continue;
    for (const m of text.matchAll(LOCATION_RE)) out.add(path.resolve(String(m[1]))); // group 1 is unconditional
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

/** The first durable dir (`plans`, `roadmaps`, `handoffs`, `implementations`) holding a file under `dir`, else null. */
export function nestedHolds(dir: string): string | null {
  return DURABLE.find((d) => holdsFile(path.join(dir, d))) ?? null;
}
