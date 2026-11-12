import { isRecord, isString, type Json, type JsonObject } from "../json.ts";
import type { Result } from "../result.ts";
import {
  CODE_FILE,
  CURRENT_DIR,
  JSON_FILE,
  REGEX_SPECIALS,
  ROOT_KEY,
  RUNTIME_CONDITIONS,
  STAR,
  TS_SOURCE,
  TYPES_CONDITION,
} from "./consumer.constants.ts";
import { NO_EXPORTS, noMatch, noRuntime } from "./release-messages.constants.ts";

/** One import path of a package: its `exports` key, the file that runs, the file that types it, and how to test it. */
export type Subpath = { key: string; runtime: string; types: string | null; kind: "code" | "json" | "other" };

/** The subpaths of an `exports` field, the number of keys it had, and a line for each key that cannot be used. */
export type Expanded = { exports: number; subpaths: Subpath[]; errors: string[] };

/** The file that runs: a string, the first array entry with one, or the first runtime condition with one. */
function runtimeOf(value: Json | undefined): string | null {
  if (isString(value)) return value;

  if (Array.isArray(value)) return value.map(runtimeOf).find((target) => target !== null) ?? null;

  if (!isRecord(value)) return null;

  for (const condition of Object.keys(value).filter((name) => RUNTIME_CONDITIONS.includes(name))) {
    const target = runtimeOf(value[condition]);

    if (target !== null) return target;
  }

  return null;
}

/** The file that types: the `types` condition, or one nested in a runtime condition, or a `.ts` runtime string. */
function typesOf(value: Json | undefined): string | null {
  if (isString(value)) return TS_SOURCE.test(value) ? value : null;

  if (Array.isArray(value)) return value.map(typesOf).find((target) => target !== null) ?? null;

  if (!isRecord(value)) return null;
  const typed = value[TYPES_CONDITION];

  if (isString(typed)) return typed;

  for (const condition of RUNTIME_CONDITIONS) {
    const target = isRecord(value[condition]) ? typesOf(value[condition]) : null;

    if (target !== null) return target;
  }

  return null;
}

function kindOf(target: string): Subpath["kind"] {
  if (JSON_FILE.test(target)) return "json";

  return CODE_FILE.test(target) ? "code" : "other";
}

/** The text with every regex special escaped, so it matches itself. */
function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIALS, "\\$&");
}

/** The pattern of files a `*` target matches, with the part the `*` stands for captured. */
function patternOf(target: string): RegExp {
  const star = target.indexOf(STAR);
  const before = target.slice(CURRENT_DIR.length, star);
  const after = target.slice(star + STAR.length);

  return new RegExp(`^${escapeRegex(before)}(.+)${escapeRegex(after)}$`);
}

/**
 * The subpaths one `exports` key stands for: itself, or a file each when it is a `*` pattern; or the line that says
 * why not.
 */
function expandKey(key: string, value: Json, files: readonly string[]): Result<Subpath[], string> {
  const runtime = runtimeOf(value);

  if (runtime === null) return { error: noRuntime(key), ok: false };
  const types = typesOf(value);

  if (!key.includes(STAR) || !runtime.includes(STAR))
    return { ok: true, value: [{ key, kind: kindOf(runtime), runtime, types }] };
  const pattern = patternOf(runtime);

  const found = files.flatMap((file) => {
    const captured = pattern.exec(file)?.[1];

    return captured === undefined ? [] : [{ captured, file }];
  });

  if (found.length === 0) return { error: noMatch(key), ok: false };

  const subpaths = found.map(({ file, captured }) => ({
    key: key.replace(STAR, captured),
    kind: kindOf(file),
    runtime: `${CURRENT_DIR}${file}`,
    types: types?.replace(STAR, captured) ?? null,
  }));

  return { ok: true, value: subpaths };
}

/** The `exports` field as a map of keys; a string, array or condition object stands for the root key. */
function keyMap(exports: Json | undefined): JsonObject | null {
  if (!isString(exports) && !Array.isArray(exports) && !isRecord(exports)) return null;

  if (isRecord(exports) && Object.keys(exports).every((key) => key.startsWith(ROOT_KEY))) return exports;

  return { [ROOT_KEY]: exports };
}

/** Expands an `exports` field against the package's files (paths relative to its root, with `/`). */
export function exportSubpaths(exports: Json | undefined, files: readonly string[]): Expanded {
  const out: Expanded = { errors: [], exports: 0, subpaths: [] };
  const map = keyMap(exports);

  if (map === null) return { ...out, errors: [NO_EXPORTS] };

  for (const [key, value] of Object.entries(map).filter(([, target]) => target !== null)) {
    out.exports += 1;
    const got = expandKey(key, value, files);

    if (got.ok) out.subpaths.push(...got.value);
    else out.errors.push(got.error);
  }

  return out;
}
