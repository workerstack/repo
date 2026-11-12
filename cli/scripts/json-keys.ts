/**
 * The key order of JSON files. `repo fmt` and turn's fmt step sort the keys of every `.json` and `.jsonc` file by code
 * unit, deep, with arrays left in order, and `repo fmt --check` names the first key out of order. A member keeps its
 * own text and the separators stay where they were, so a file's layout does not change; a file that does not parse as
 * JSON with comments is left alone. `package.json` is oxfmt's (`sortPackageJson`), and so is every file the generated
 * oxfmt config ignores.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { childEnv } from "../env.ts";
import { tryJson } from "../json.ts";
import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import {
  ANCHOR,
  ANY_DEPTH,
  COMMENT_LINE,
  INDENT,
  JSONC_EXTENSIONS,
  JSONC_PATHSPECS,
  MANIFEST_NAME,
  SYNC_AGAIN_HINT,
  SYNC_HINT,
  UNDER,
} from "./json-keys.constants.ts";
import { GIT_CONFIG_ENV, GIT_ENV_PREFIX } from "./lint.constants.ts";
import { sortedJsonText } from "./sorted-json-text.ts";

/** A file whose keys are out of order, and the path of the first key that is. */
type Found = { file: string; key: string };

type Listed = { ok: true; files: string[] };

type Sort = { ok: true; found: Found[] } | { ok: false; error: string };

/** Code-unit order, which `<` on strings is. */
function compare(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

/** `value` as indented JSON ending in a newline, every key sorted by code unit, deep: how a repo writer emits JSON. */
export function sortedJsonValue(data: unknown, indent: number = INDENT): string {
  const text = `${JSON.stringify(data, null, indent)}\n`;

  return sortedJsonText(text)?.text ?? text;
}

/**
 * git's environment without the `GIT_*` variables a hook hands over, which would aim it at the repo being committed.
 */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(childEnv()).filter(([name]) => !name.startsWith(GIT_ENV_PREFIX) || GIT_CONFIG_ENV.test(name)),
  );
}

/** What listing the json files gives back: git's exit status (null when it did not run) and its output. */
type GitListing = { status: number | null; stdout: string };

/** Runs `git ls-files` at `root`; `repoJson` takes another in tests. */
export type GitLister = (root: string) => GitListing;

/** The real lister of `*.json` and `*.jsonc`: untracked files git does not ignore, and the tracked ones. */
function gitList(root: string): GitListing {
  return spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", ...JSONC_PATHSPECS], {
    cwd: root,
    encoding: "utf8",
    env: gitEnv(),
  });
}

/**
 * The json and jsonc files of the repo at `root` that exist now, tracked or untracked and not git-ignored, as sorted
 * `/` paths relative to it; none when git cannot list them (no git, or `root` is no repo), so there is nothing to sort.
 * `paths` (relative to `root`) narrows them to a file or a folder each; null keeps them all.
 */
export function repoJson(root: string, paths: readonly string[] | null, list: GitLister = gitList): Listed {
  const run = list(root);

  if (run.status !== 0) return { files: [], ok: true };

  function within(rel: string) {
    return paths === null || paths.some((under) => under === "" || rel === under || rel.startsWith(`${under}/`));
  }

  const files = run.stdout
    .split("\0")
    .filter((rel) => rel !== "" && within(rel) && fs.existsSync(path.join(root, rel)))
    .toSorted(compare);

  return { files, ok: true };
}

/** The `ignorePatterns` of the generated oxfmt config text, or null when it is not a config. */
function ignoresOf(text: string): string[] | null {
  const config = tryJson(z.object({ ignorePatterns: z.array(z.string()).optional() }), text.replace(COMMENT_LINE, ""));

  return config === undefined ? null : (config.ignorePatterns ?? []);
}

/**
 * The globs of `ignorePatterns`: `/x` is anchored at the root, any other pattern matches at any depth, and a folder
 * matches what lies under it.
 */
function ignoreGlobs(patterns: readonly string[]): Bun.Glob[] {
  return patterns.flatMap((pattern) => {
    const deep = pattern.startsWith(ANY_DEPTH) ? pattern : `${ANY_DEPTH}${pattern}`;
    const base = pattern.startsWith(ANCHOR) ? pattern.slice(ANCHOR.length) : deep;

    return [new Bun.Glob(base), new Bun.Glob(`${base}${UNDER}`)];
  });
}

/**
 * Sorts the keys of the json files among `files` (paths relative to `root`, `/`-separated) that the generated oxfmt
 * config does not ignore and that are not `package.json`; under `check` it only reports them. A file that is gone or
 * does not parse as JSON with comments is skipped.
 */
export function sortJson(root: string, files: readonly string[], { check }: { check: boolean }): Sort {
  const config = path.join(root, OXFMT_CONFIG_PATH);

  if (!fs.existsSync(config)) return { error: `${OXFMT_CONFIG_PATH} is missing; ${SYNC_HINT}`, ok: false };
  const patterns = ignoresOf(fs.readFileSync(config, "utf8"));

  if (patterns === null)
    return { error: `${OXFMT_CONFIG_PATH} is not a valid oxfmt config; ${SYNC_AGAIN_HINT}`, ok: false };
  const globs = ignoreGlobs(patterns);
  const found: Found[] = [];

  for (const rel of files) {
    const skipped = !JSONC_EXTENSIONS.some((ext) => rel.endsWith(ext)) || path.posix.basename(rel) === MANIFEST_NAME;
    const file = path.join(root, rel);

    if (skipped || globs.some((glob) => glob.match(rel)) || !fs.existsSync(file)) continue;
    const sorted = sortedJsonText(fs.readFileSync(file, "utf8"));

    if (sorted === null) continue;
    found.push({ file: rel, key: sorted.key });

    if (!check) fs.writeFileSync(file, sorted.text);
  }

  return { found, ok: true };
}
