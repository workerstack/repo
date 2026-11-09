import path from "node:path";
import { ATTR_SET, ATTR_TOKENS, ATTR_TRUE, ATTR_VALUE_AT, RENAME_PATHS } from "./staged-change.constants.ts";
import { type GitRun, runGit } from "./sync/standards.ts";

/** Files whose size says nothing about the change: lockfiles, by name anywhere, and the lint baseline. */
const UNCOUNTED_NAMES: readonly string[] = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];
const UNCOUNTED_PATHS: readonly string[] = [".repo/lint-baseline.json"];

/** The staged change: every path, and the changed lines that count toward the size limit. */
export type StagedChange = { files: string[]; changedLines: number };

/** One `git diff --numstat -z` entry: its path, and its changed lines, or null for a binary file. */
type Numstat = { file: string; lines: number | null };

/** The entries of `git diff --numstat -z`; a rename is `a\td\t` followed by its old and new path. */
function parseNumstat(out: string): Numstat[] {
  const tokens = out.split("\0");
  const entries: Numstat[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tokens[i] /* i < tokens.length */ as string);
    if (match === null) continue;
    const [, added, deleted, named] = match;
    const file = named ? named : (tokens[(i += RENAME_PATHS)] /* a rename lists both paths */ as string);
    entries.push({ file, lines: added === "-" ? null : Number(added) + Number(deleted) });
  }
  return entries;
}

/** The paths among `files` the staged `.gitattributes` mark `linguist-generated`. */
function generatedPaths(root: string, files: readonly string[], git: GitRun): Set<string> {
  const result = git(root, ["check-attr", "--cached", "-z", "--stdin", "linguist-generated"], files.join("\0"));
  const tokens = result.stdout.split("\0");
  const generated = new Set<string>();
  for (let i = 0; i + ATTR_VALUE_AT < tokens.length; i += ATTR_TOKENS) {
    if (tokens[i + ATTR_VALUE_AT] === ATTR_SET || tokens[i + ATTR_VALUE_AT] === ATTR_TRUE)
      generated.add(tokens[i] /* i < tokens.length */ as string);
  }
  return generated;
}

/**
 * The staged change at `root`: every staged path, and the insertions plus deletions that count toward the size
 * limit, leaving out binaries, lockfiles, the lint baseline and `linguist-generated` paths. Nothing outside a repo.
 */
export function stagedChange(root: string, git: GitRun = runGit): StagedChange {
  const diff = git(root, ["diff", "--cached", "--numstat", "-z"]);
  if (diff.status !== 0) return { files: [], changedLines: 0 };
  const entries = parseNumstat(diff.stdout);
  const files = entries.map((entry) => entry.file);
  const generated = generatedPaths(root, files, git);
  const counted = entries.filter(
    ({ file }) =>
      !UNCOUNTED_NAMES.includes(path.posix.basename(file)) && !UNCOUNTED_PATHS.includes(file) && !generated.has(file),
  );
  return { files, changedLines: counted.reduce((sum, entry) => sum + (entry.lines ?? 0), 0) };
}
