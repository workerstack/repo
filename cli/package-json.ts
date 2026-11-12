// The slice of a package.json init reads, and a reader that refuses any other shape.
import fs from "node:fs";

import { isRecord } from "./json.ts";

/** The slice of package.json init reads; other keys pass through. */
export type PackageJson = {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

function isStringRecord(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string");
}

/** True when name and version are strings and the script and dependency maps hold only strings. */
export function isPackageJson(v: unknown): v is PackageJson {
  return (
    isRecord(v) &&
    [v.name, v.version].every((x) => x === undefined || typeof x === "string") &&
    [v.scripts, v.dependencies, v.devDependencies].every((x) => x === undefined || isStringRecord(x))
  );
}

/** The JSON file at `file`, refused with a clear error unless `is` accepts its shape. */
export function readJsonFile<T>(file: string, is: (v: unknown) => v is T): T {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));

  if (!is(value)) throw new Error(`${file} does not hold the shape repo needs`);

  return value;
}
