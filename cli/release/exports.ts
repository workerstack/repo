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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The file that runs: a string, the first array entry with one, or the first runtime condition with one. */
function runtimeOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(runtimeOf).find((target) => target !== null) ?? null;
  if (!isObject(value)) return null;
  for (const condition of Object.keys(value).filter((name) => RUNTIME_CONDITIONS.includes(name))) {
    const target = runtimeOf(value[condition]);
    if (target !== null) return target;
  }
  return null;
}

/** The file that types: the `types` condition, or one nested in a runtime condition, or a `.ts` runtime string. */
function typesOf(value: unknown): string | null {
  if (typeof value === "string") return TS_SOURCE.test(value) ? value : null;
  if (Array.isArray(value)) return value.map(typesOf).find((target) => target !== null) ?? null;
  if (!isObject(value)) return null;
  const typed = value[TYPES_CONDITION];
  if (typeof typed === "string") return typed;
  for (const condition of RUNTIME_CONDITIONS) {
    const target = isObject(value[condition]) ? typesOf(value[condition]) : null;
    if (target !== null) return target;
  }
  return null;
}

const kindOf = (target: string): Subpath["kind"] => {
  if (JSON_FILE.test(target)) return "json";
  return CODE_FILE.test(target) ? "code" : "other";
};

/** The pattern of files a `*` target matches, with the part the `*` stands for captured. */
const patternOf = (target: string): RegExp => {
  const star = target.indexOf(STAR);
  const before = target.slice(CURRENT_DIR.length, star);
  const after = target.slice(star + STAR.length);
  const escape = (text: string) => text.replace(REGEX_SPECIALS, "\\$&");
  return new RegExp(`^${escape(before)}(.+)${escape(after)}$`);
};

/** The subpaths one `exports` key stands for: itself, or a file each when it is a `*` pattern; or the line that says why not. */
function expandKey(key: string, value: unknown, files: readonly string[]): Subpath[] | string {
  const runtime = runtimeOf(value);
  if (runtime === null) return noRuntime(key);
  const types = typesOf(value);
  if (!key.includes(STAR) || !runtime.includes(STAR)) return [{ key, runtime, types, kind: kindOf(runtime) }];
  const pattern = patternOf(runtime);
  const found = files.flatMap((file) => {
    const captured = pattern.exec(file)?.[1];
    return captured === undefined ? [] : [{ file, captured }];
  });
  if (found.length === 0) return noMatch(key);
  return found.map(({ file, captured }) => ({
    key: key.replace(STAR, captured),
    runtime: `${CURRENT_DIR}${file}`,
    types: types?.replace(STAR, captured) ?? null,
    kind: kindOf(file),
  }));
}

/** The `exports` field as a map of keys; a string, array or condition object stands for the root key. */
function keyMap(exports: unknown): Record<string, unknown> | null {
  if ((typeof exports !== "string" && typeof exports !== "object") || exports === null) return null;
  if (isObject(exports) && Object.keys(exports).every((key) => key.startsWith(ROOT_KEY))) return exports;
  return { [ROOT_KEY]: exports };
}

/** Expands an `exports` field against the package's files (paths relative to its root, with `/`). */
export function exportSubpaths(exports: unknown, files: readonly string[]): Expanded {
  const out: Expanded = { exports: 0, subpaths: [], errors: [] };
  const map = keyMap(exports);
  if (map === null) return { ...out, errors: [NO_EXPORTS] };
  for (const [key, value] of Object.entries(map).filter(([, target]) => target !== null)) {
    out.exports += 1;
    const got = expandKey(key, value, files);
    if (typeof got === "string") out.errors.push(got);
    else out.subpaths.push(...got);
  }
  return out;
}
