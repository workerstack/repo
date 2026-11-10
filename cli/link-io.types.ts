/** What `repo link` and `repo unlink` touch outside their own process, so a test can stand in for each. */
export type LinkIo = {
  /** The directory the command was run from. */
  cwd: string;
  /** Writes one line to standard output. */
  out: (line: string) => void;
  /** Writes one line to standard error. */
  err: (line: string) => void;
  /** Runs `git <args>` in a directory; the trimmed standard output, or null when git fails. */
  git: (cwd: string, args: readonly string[]) => string | null;
  /** Runs `bun install` in a directory, capturing what it prints; its exit code and that output. */
  install: (root: string) => { code: number; output: string };
  /** The current time, for the sync times a link records. */
  now: () => Date;
};

/** The directories one command works between. */
export type LinkRoots = {
  /** This checkout: the worktree the command ran in. */
  checkout: string;
  /** The main checkout, the parent of git's common dir. */
  main: string;
  /** The checkout whose install dir and state the command acts on. */
  install: string;
  /** The directory the sibling checkouts sit in: the main checkout's parent. */
  siblings: string;
};

/** A linkable package: its name, its directory, and the checkout that holds it. */
export type LinkTarget = {
  name: string;
  dir: string;
  checkout: string;
};

/** What every step of one command needs. */
export type LinkContext = {
  /** `link` or `unlink`, for the prefix of its error lines. */
  command: string;
  io: LinkIo;
  roots: LinkRoots;
};
