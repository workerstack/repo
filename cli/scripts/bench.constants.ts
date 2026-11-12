/** What `repo bench` prints and exits with, and where it finds specs and writes raw results. */
export const BENCH_SUMMARY = "Score candidate commands on a .repo/bench spec (--remote: its other OSes in CI too)";
export const USAGE = "usage: bun repo bench <name> [--remote]";
export const REMOTE_FLAG = "--remote";
export const PREFIX = "repo bench: ";
/** Where specs live and their file suffix, relative to the repo root. */
export const SPEC_DIR = ".repo/bench";
export const SPEC_SUFFIX = ".bench.ts";
/** Where each run writes its raw result, as `<spec>/<os label>.json`. */
export const RAW_DIR = ".repo/tmp/bench";
export const JSON_INDENT = 2;
export const EXIT_OK = 0;
/** A candidate or a remote run failed. */
export const EXIT_FAILED = 1;
/** A bad argument, spec or precondition. */
export const EXIT_USAGE = 4;
export const GIT_HEAD: readonly string[] = ["rev-parse", "HEAD"];
export const GIT_STATUS: readonly string[] = ["status", "--porcelain"];
