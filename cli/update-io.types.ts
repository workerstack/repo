import type { LatestFetch } from "./check-latest.ts";
import type { Env } from "./env.ts";

/** What a tool run reports: its exit code and everything it printed. */
export type ToolResult = { code: number; output: string };

/** What `repo update` touches outside its own process, so a test can stand in for each. */
export type UpdateIo = {
  /** The directory the command was run from. */
  cwd: string;
  env: Env;
  /** Writes one line to standard output. */
  out: (line: string) => void;
  /** Writes one line to standard error. */
  err: (line: string) => void;
  /** Asks the registry; takes the signal that bounds the wait. */
  fetch: LatestFetch;
  /** Runs `bun install` in a directory, capturing what it prints. */
  install: (root: string) => ToolResult;
  /** Formats root-relative files in a directory the way `repo fmt` does. */
  format: (root: string, files: string[]) => ToolResult;
};
