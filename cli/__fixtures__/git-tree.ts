import { execFileSync } from "node:child_process";

import { useTempTree } from "./temp-tree.ts";

/** Makers of temp git repos holding `files` (path → content). */
export type GitTree = {
  /** A plain dir, no git repo. */
  readonly plant: (files: Record<string, string>) => string;
  /** A repo with every file added to the index. */
  readonly repoWith: (files: Record<string, string>) => string;
  /** A repo with no file added to the index. */
  readonly untrackedRepo: (files: Record<string, string>) => string;
};

/** Per test file: temp git repos removed after each test, named from `prefix`. */
export function useGitTree(prefix: string): GitTree {
  const plant = useTempTree(prefix);
  function untrackedRepo(files: Record<string, string>): string {
    const dir = plant(files);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    return dir;
  }
  function repoWith(files: Record<string, string>): string {
    const dir = untrackedRepo(files);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    return dir;
  }
  return { plant, repoWith, untrackedRepo };
}
