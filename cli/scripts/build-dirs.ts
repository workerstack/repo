/** The ignored build dirs, tsbuildinfo files and node_modules `repo clean --build` and `--deps` remove. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { childEnv } from "../env.ts";
import { BUILD_DIRS, LIST_BUFFER, MODULES_DIR, TSBUILDINFO_SUFFIX } from "./build-dirs.constants.ts";

/** One path to remove: a build dir, a tsbuildinfo file or a node_modules dir, with the bytes under it. */
export type BuildItem = {
  path: string;
  kind: "dir" | "info" | "modules";
  bytes: number;
};

/** What `planBuild` gives back: the items, or why git could not list the ignored paths. */
export type BuildPlan = { ok: true; items: BuildItem[] } | { ok: false; error: string };

/** The bytes under `p`; a symlink counts by itself and is never followed. */
function bytesUnder(p: string): number {
  const st = fs.lstatSync(p);

  if (!st.isDirectory()) return st.size;

  return fs.readdirSync(p).reduce((sum, name) => sum + bytesUnder(path.join(p, name)), 0);
}

/** The kind of item git's ignored `entry` is, or null: `--directory` ends a dir with a slash. */
function kindOf(
  entry: string,
  { deps, names }: { deps: boolean; names: ReadonlySet<string> },
): BuildItem["kind"] | null {
  const isDir = entry.endsWith("/");
  const base = path.posix.basename(entry);

  if (!isDir) return base.endsWith(TSBUILDINFO_SUFFIX) ? "info" : null;

  if (deps && base === MODULES_DIR) return "modules";

  return names.has(base) ? "dir" : null;
}

/**
 * The paths under `root` that git ignores and that are build output: `git ls-files -o -i --directory` lists only
 * untracked, ignored paths, so a tracked file or an unignored dir is never planned. Matches by basename.
 */
export function planBuild(root: string, { deps, extra }: { deps: boolean; extra: readonly string[] }): BuildPlan {
  const listed = spawnSync("git", ["ls-files", "-o", "-i", "--directory", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    env: childEnv(),
    maxBuffer: LIST_BUFFER,
  });

  if (listed.status !== 0) return { error: `git ls-files failed: ${listed.stderr.trim()}`, ok: false };
  const names = new Set([...BUILD_DIRS, ...extra]);
  const items: BuildItem[] = [];

  for (const entry of listed.stdout.split("\0")) {
    const kind = kindOf(entry, { deps, names });

    if (kind === null) continue;
    const abs = path.resolve(root, entry);
    items.push({ bytes: bytesUnder(abs), kind, path: abs });
  }

  return { items, ok: true };
}

/** What `removeBuild` did: the items gone (or that would go), and the ones the delete failed on with its code. */
export type BuildResult = {
  done: BuildItem[];
  skipped: { path: string; code: string | undefined }[];
};

/** Removes each item with `rm` unless `dryRun`; a failure is recorded and the rest go on. */
export function removeBuild(
  items: readonly BuildItem[],
  { dryRun, rm }: { dryRun: boolean; rm: typeof fs.rmSync },
): BuildResult {
  const result: BuildResult = { done: [], skipped: [] };

  for (const item of items) {
    try {
      if (!dryRun) rm(item.path, { force: true, recursive: true });
      result.done.push(item);
    } catch (err) {
      result.skipped.push({
        code: (err /* rm throws an fs error that carries a code */ as NodeJS.ErrnoException).code,
        path: item.path,
      });
    }
  }

  return result;
}
