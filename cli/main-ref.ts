/** Main's ref and main's copy of a file, read from git; no main ref means there is nothing to compare with. */
import { spawnSync } from "node:child_process";

import { childEnv } from "./env.ts";
import { COMMON_BRANCHES, DETACHED, ORIGIN } from "./main-ref.constants.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { defaultBranch } from "./scripts/worktree-git.ts";

/** git's stdout, or null when it failed; run without any `GIT_*` variable a hook set. */
export function git(root: string, args: string[]): string | null {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", env: toolEnv(childEnv()) });

  return run.status === 0 ? run.stdout : null;
}

function hasRef(root: string, ref: string) {
  return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

/** The branches a clone without a local main may still have as `origin/<name>`. */
function originNames(root: string): string[] {
  const head = git(root, ["symbolic-ref", "--short", `refs/remotes/${ORIGIN}/HEAD`]);

  return [head?.trim().replace(`${ORIGIN}/`, "") ?? "", ...COMMON_BRANCHES].filter(Boolean);
}

/**
 * Main's ref: the local default branch, else `origin/<name>`. The default branch falling back to the current branch
 * (or HEAD) is no main, since that compares a branch with itself.
 */
export function mainRef(root: string): string | null {
  const name = defaultBranch(root);
  const current = git(root, ["symbolic-ref", "--short", "HEAD"])?.trim();

  if (name !== DETACHED && name !== current && hasRef(root, name)) return name;
  const remote = [name, ...originNames(root)].map((n) => `${ORIGIN}/${n}`);

  return remote.find((ref) => hasRef(root, ref)) ?? null;
}

/** The text of `rel` (root-relative) at `ref`; null when git cannot show it, as when main lacks the file. */
export function showOnMain(root: string, ref: string, rel: string): string | null {
  return git(root, ["show", `${ref}:${rel}`]);
}
