/** Which files changed since a git base, and the first one an eval reads, for `repo eval --changed <base>`. */
import { listFiles } from "../list-files.ts";
import { git } from "../main-ref.ts";

/**
 * The repo-relative paths that differ from the merge base of `base` and HEAD, uncommitted edits included, plus the
 * untracked files; null when git cannot diff against `base`.
 */
export function changedFiles(root: string, base: string): string[] | null {
  const diff = git(root, ["diff", "--name-only", "-z", "--relative", "--merge-base", base]);

  if (diff === null) return null;

  return [...new Set([...diff.split("\0").filter(Boolean), ...listFiles(root, ["-o", "--exclude-standard"])])];
}

/** The first of `changed` that eval `name` reads: a listed file, a path under a listed folder or under its own. */
export function firstChanged(name: string, files: readonly string[], changed: readonly string[]): string | undefined {
  const read = [...files, `evals/${name}`];

  return changed.find((rel) => read.some((listed) => rel === listed || rel.startsWith(`${listed}/`)));
}
