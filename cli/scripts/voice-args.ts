/** The argv, JSON and string helpers `repo listen` and `repo speak` share. */
import fs from "node:fs";

import { z } from "zod";

import { isRecord, type Json, tryJson, type JsonObject } from "../json.ts";
import type { ParsedArgv } from "./parsed-argv.types.ts";
import { FLAG_ON, FLAG_PREFIX } from "./voice-args.constants.ts";

/** Records one argument; true when it took `next` as its value. */
function take(out: ParsedArgv, arg: string, next: string | undefined): boolean {
  if (!arg.startsWith(FLAG_PREFIX)) {
    out._.push(arg);

    return false;
  }

  const key = arg.slice(FLAG_PREFIX.length);

  if (next !== undefined && next !== "" && !next.startsWith(FLAG_PREFIX)) {
    out.flags[key] = next;

    return true;
  }

  out.flags[key] = FLAG_ON;

  return false;
}

/** Positionals and `--flag value` pairs; a flag with no value is "1", and `--` ends the flags. */
export function parseArgv(argv: readonly string[]): ParsedArgv {
  const out: ParsedArgv = { _: [], flags: {} };
  const end = argv.indexOf(FLAG_PREFIX);
  const head = end < 0 ? argv : argv.slice(0, end);
  let isSkipping = false;

  for (const [i, arg] of head.entries()) isSkipping = isSkipping ? false : take(out, arg, head[i + 1]);

  if (end >= 0) out._.push(...argv.slice(end + 1));

  return out;
}

/** The JSON object at `p`, or an empty one when it is missing, broken or not an object. */
export function readObjectFile(p: string): JsonObject {
  try {
    return tryJson(z.record(z.string(), z.json()), fs.readFileSync(p, "utf8")) ?? {};
  } catch {
    return {};
  }
}

/** `v` as a trimmed string, or `fallback` when that is empty; null, objects and arrays read as empty. */
export function str(v: Json | undefined, fallback = ""): string {
  const s = v === undefined || typeof v === "object" ? "" : String(v).trim();

  return s === "" ? fallback : s;
}

/** The object under `key`, or an empty one. */
export function section(file: JsonObject, key: string): JsonObject {
  const value = file[key];

  return isRecord(value) ? value : {};
}
