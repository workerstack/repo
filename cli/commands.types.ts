/** The shapes of the command and hook registry in `commands.ts`. */
import type { HookName } from "./scripts/hook-command.ts";

export type Main = (argv: string[]) => number | Promise<number>;

/** A registry command: the script it loads on demand, its `repo --help` summary, and its `--help` usage line. */
export type Entry = {
  readonly summary: string;
  /** The line `repo <cmd> --help` prints before the summary. */
  readonly usage: string;
  readonly load: () => Promise<{ readonly main: Main }>;
};

/** A hook: loaded like a command, called by hosts with stdin JSON, so it has no usage line. */
export type HookEntry = {
  /** Arguments the hook's `main` gets in front of any the command line adds. */
  readonly argv: readonly string[];
} & Omit<Entry, "usage">;

export type CommandName =
  | "job"
  | "worktree"
  | "persist"
  | "phase-files"
  | "lessons"
  | "backlog"
  | "bench"
  | "browser"
  | "changelog"
  | "google-workspace"
  | "jev"
  | "listen"
  | "speak"
  | "setup"
  | "doctor"
  | "env"
  | "eval"
  | "clean"
  | "yolo"
  | "shim"
  | "purge-mcps"
  | "tasks"
  | "lint"
  | "fmt"
  | "turn"
  | "ci"
  | "coverage"
  | "mutate"
  | "release"
  | "commit-msg"
  | "push"
  | "github"
  | "link"
  | "unlink"
  | "update"
  | "remove"
  | "docs"
  | "fixtures";

/** The tables `dispatch` runs from; tests pass stubs. */
export type Registry = {
  readonly commands: Readonly<Record<CommandName, Entry>>;
  readonly hooks: Readonly<Record<HookName, HookEntry>>;
};
