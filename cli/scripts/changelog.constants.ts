import { SECTION_LIST } from "../release/release.constants.ts";

/** What `repo changelog` takes, how it is summed up and its usage line. */
const CHANGELOG_ARGS: string = "[--dir <dir>] | add <section> <text> [--dir <dir>]";
export const CHANGELOG_SUMMARY = "Print and add [Unreleased] entries of CHANGELOG.md";
export const USAGE: string = `usage: repo changelog ${CHANGELOG_ARGS}`;

/** Exit codes: a usage error, and a refusal of a well-formed request. */
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 1;

export const DIR_FLAG = "--dir";
export const ADD_VERB = "add";
export const ROOT_DIR = ".";
export const CRLF = "\r\n";
export const LINE_END: RegExp = /\r?\n/;
export const LINE_BREAK: RegExp = /[\r\n]/;

/** `Array#indexOf` for no match, the width of a flag with its value, and where a `git status -z` path starts. */
export const NOT_FOUND = -1;
export const FLAG_WIDTH = 2;
export const STATUS_PATH_AT = 3;
export const STATUS_CODE_WIDTH = 2;

/** A `git status` code that is followed by the old path: a rename or a copy. */
export const RENAMED: RegExp = /^[RC]|^.[RC]/;

/** Where the owner of an entry comes from. */
export const STAGED = "staged";
export const CHANGED = "changed";

export const BAD_SECTION: string = `section must be ${SECTION_LIST}`;
export const ONE_LINE = "the entry is one line";
export const OUTSIDE = "--dir must be inside the checkout";
export const NO_OWNER = "no staged or changed file is in a public package; pass --dir <package dir>";

export function spans(source: string, dirs: readonly string[]): string {
  return `the ${source} files span ${dirs.join(", ")}; pass --dir <package dir>`;
}

export function emptyUnreleased(file: string): string {
  return `[Unreleased] in ${file} is empty`;
}
