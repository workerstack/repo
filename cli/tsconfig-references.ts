import fs from "node:fs";
import path from "node:path";

import { parse, type ParseError } from "jsonc-parser";
import { z } from "zod";

import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";

const QUOTES = /^["']|["']$/g;

/** The config a `-p` or `-b` value or a reference `path` names from `dir`: the file, or a folder's `tsconfig.json`. */
export function projectFile(dir: string, spec: string): string {
  const target = path.posix.join(dir, spec.replaceAll(QUOTES, ""));

  return target.endsWith(".json") ? target : path.posix.join(target, RUNTIME_CONFIG);
}

/** A config's `references`, each any JSON: only an entry with a string `path` names a config. */
function configSchema() {
  return z.object({ references: z.array(z.json()) }).catch({ references: [] });
}

/** A reference with its `path`. */
function referenceSchema() {
  return z.object({ path: z.string() });
}

/**
 * The configs the posix `file`'s own `references` name, each spelled from its dir. TypeScript does not inherit
 * `references` through `extends`, so the field in the file is the whole list. None when the file is missing, is not
 * valid JSON with comments, or lists no reference with a string `path`.
 */
export function referencedConfigs(file: string): string[] {
  let text: string;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const errors: ParseError[] = [];
  const config: unknown = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) return [];
  const dir = path.posix.dirname(file);

  return configSchema()
    .parse(config)
    .references.flatMap((ref) => {
      const parsed = referenceSchema().safeParse(ref);

      return parsed.success ? [projectFile(dir, parsed.data.path)] : [];
    });
}
