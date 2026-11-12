/**
 * The Tailwind v4 entry sheet oxlint checks classes against: `lint.tailwind.entryPoint` when the config sets it, else
 * the one stylesheet Stylelint lints that imports tailwindcss. Sync and the unskipped `repo check` run both read it.
 */
import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { type ResolvedLint } from "../config.ts";
import { cssFiles } from "../css/css-diagnostics.ts";
import { COUNT_WORDS, TAILWIND_IMPORT } from "./tailwind-entry.constants.ts";

const AT = `${CONFIG_FILE}: lint.tailwind.entryPoint`;

/** `lint` with the entry sheet set when there is one, or why sync cannot pick it. */
export type TailwindLint = { ok: true; lint: ResolvedLint } | { ok: false; errors: string[] };

/** The text of the file at root-relative `rel`, or null when no file is there. */
function fileText(root: string, rel: string): string | null {
  const file = path.join(root, rel);

  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true ? fs.readFileSync(file, "utf8") : null;
}

/** Whether a sheet's text has a line importing tailwindcss itself. */
function importsTailwind(text: string | null): boolean {
  return text !== null && TAILWIND_IMPORT.test(text);
}

/** Why the configured entry cannot be the theme oxlint loads: no file there, or one not importing tailwindcss. */
function entryErrors(root: string, entryPoint: string): string[] {
  const text = fileText(root, entryPoint);

  if (text === null) return [`${AT}: ${JSON.stringify(entryPoint)} is not a file`];

  return importsTailwind(text) ? [] : [`${AT}: ${JSON.stringify(entryPoint)} does not import tailwindcss`];
}

/**
 * `lint` with the entry sheet under `root`: the configured one once it is a file importing tailwindcss, else the one
 * linted sheet that imports it. Two or more need `lint.tailwind.entryPoint`, since oxlint loads one theme; none, or
 * no git checkout to list them in, leaves `lint` as it is and the class rules off.
 */
export function withTailwindEntry(root: string, lint: ResolvedLint): TailwindLint {
  const configured = lint.tailwind?.entryPoint;

  if (configured !== undefined) {
    const errors = entryErrors(root, configured);

    return errors.length > 0 ? { errors, ok: false } : { lint, ok: true };
  }

  const listed = cssFiles(root);
  const entries = listed.ok ? listed.files.filter((rel) => importsTailwind(fileText(root, rel))) : [];
  const [entryPoint, ...others] = entries;

  if (entryPoint === undefined) return { lint, ok: true };

  if (others.length === 0) return { lint: { ...lint, tailwind: { entryPoint } }, ok: true };
  const count = COUNT_WORDS[entries.length] ?? String(entries.length);
  const list = entries.join(", ");

  return {
    errors: [`${AT}: ${count} sheets import tailwindcss (${list}); set the one oxlint checks classes against`],
    ok: false,
  };
}
