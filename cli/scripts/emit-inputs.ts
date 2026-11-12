/** What the emitters read: a file's text when it exists, and a root option that falls back when unset or empty. */
import fs from "node:fs";

import { NOT_FOUND } from "./emit.constants.ts";

/** The text of `abs`, or null when it does not exist; any other read failure throws. */
export function readTextOrNull(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === NOT_FOUND) return null;
    throw err;
  }
}

/** `value`, or `fallback` when it is undefined or empty. */
export function nonEmptyOr<T>(value: string | undefined, fallback: T): string | T {
  return value === undefined || value === "" ? fallback : value;
}
