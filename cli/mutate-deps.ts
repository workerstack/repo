import type { Captured } from "./scripts/lint.ts";
import { FAILED, NEWLINE } from "./mutate.constants.ts";

/** What `repo mutate` reads from workerstack.config.ts: the repo root, the globs to mutate, the floors file. */
export type MutateConfig = { root: string; mutate: readonly string[]; floors: string };

/** The file system `repo mutate` touches; paths are absolute. */
export type MutateFs = {
  /** A new empty dir named `<prefix><random>` under the OS temp dir. */
  mkdtemp: (prefix: string) => string;
  rm: (target: string) => void;
  /** The text of a file, or null when it is missing. */
  read: (file: string) => string | null;
  /** Writes `text`, creating the parent dirs. */
  write: (file: string, text: string) => void;
  /** The names in a dir, or null when it is missing. */
  list: (dir: string) => string[] | null;
};

/** Everything `repo mutate` does outside this process, injected so a test runs none of it. */
export type MutateDeps = {
  cwd: string;
  /** The config of the repo holding `cwd`, or the lines that say why there is none. */
  config: (cwd: string) => Promise<MutateConfig | string[]>;
  /** The workspace package dirs of the root, root-relative. */
  packages: (root: string) => string[];
  /** `git <args>` in `cwd`, run with no `GIT_*` variable. */
  git: (cwd: string, args: string[]) => Captured;
  /** `bun <args>` in `cwd`, run with no `GIT_*` variable. */
  run: (args: string[], cwd: string) => Captured;
  fs: MutateFs;
  /** Absolute path of `stryker-preload.ts`. */
  preload: string;
  out: (text: string) => void;
  err: (text: string) => void;
};

/** Prints each line as a `repo mutate:` error and answers with the failing exit code. */
export function fail(deps: MutateDeps, ...lines: string[]): number {
  for (const line of lines) deps.err(`repo mutate: ${line}${NEWLINE}`);
  return FAILED;
}
