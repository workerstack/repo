// The slice of a package.json init and the slice readers read, and a reader that refuses any other shape.
import fs from "node:fs";

import { z } from "zod";

import { readJson } from "./json.ts";
import { errorMessage } from "./sync-errors.ts";

type Strings = z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;

/** The slice of package.json init reads: names and versions as strings, script and dependency maps of strings. */
export const packageJsonSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
    scripts: Strings;
    dependencies: Strings;
    devDependencies: Strings;
  },
  z.core.$loose
> = /* @__PURE__ */ buildPackageJsonSchema();

function buildPackageJsonSchema() {
  const strings = z.record(z.string(), z.string()).optional();

  // Loose, so the keys init does not read pass through to the manifest it writes back.
  return z.looseObject({
    dependencies: strings,
    devDependencies: strings,
    name: z.string().optional(),
    scripts: strings,
    version: z.string().optional(),
  });
}

/** A package.json as init reads it; other keys pass through. */
export type PackageJson = z.output<typeof packageJsonSchema>;

/**
 * The JSON file at `file` read through `schema`. Throws an Error that starts with `file`, then the SyntaxError's
 * message for text that is not JSON or zod's prettified issues for a shape `schema` refuses.
 */
export function readJsonFile<S extends z.ZodType>(file: string, schema: S): z.output<S> {
  const text = fs.readFileSync(file, "utf8");

  try {
    return readJson(schema, text);
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`, { cause: error });
  }
}
