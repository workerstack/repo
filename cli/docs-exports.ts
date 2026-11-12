import { LAST_INDEX } from "./docs-fences.constants.ts";
import { SKIPPED_EXPORTS, noReferencesExport, REFERENCES_EXPORT, unnamedExport } from "./docs.constants.ts";
import type { Json } from "./json.ts";

/**
 * A public entry point: the text a reference must hold quoted, whether it is a prefix (`./x/*`), and how to print
 * it.
 */
export type Specifier = { text: string; prefix: boolean; shown: string };

/** Whether a manifest is published: this repo's rule is `"private": false`, as `repo check` reads it. */
export function isPublic(manifest: { private?: boolean | undefined }): boolean {
  return manifest.private === false;
}

/** The keys of `exports`; a string or a bare condition map is the `.` entry. */
function exportKeys(exports: Json | undefined): string[] {
  if (typeof exports !== "object" || exports === null || Array.isArray(exports))
    return exports === undefined ? [] : ["."];
  const keys = Object.keys(exports);

  return keys.some((key) => key.startsWith(".")) ? keys : ["."];
}

/**
 * The specifiers `name` exports but `./package.json` and `./references/*`: `.` is the name, `./x/*` the prefix
 * `name/x/`.
 */
export function specifiersOf(name: string, exports: Json | undefined): Specifier[] {
  return exportKeys(exports)
    .filter((key) => !SKIPPED_EXPORTS.includes(key))
    .map((key) => {
      const subpath = key.slice(1);

      if (key.endsWith("/*"))
        return { prefix: true, shown: `${name}${subpath}`, text: `${name}${subpath.slice(0, LAST_INDEX)}` };

      return { prefix: false, shown: `${name}${subpath}`, text: `${name}${subpath}` };
    });
}

/** Whether `text` holds the specifier in quotes or backticks; a prefix needs only its opening quote. */
function named(text: string, { text: wanted, prefix }: Specifier): boolean {
  return ['"', "'", "`"].some((quote) => text.includes(`${quote}${wanted}${prefix ? "" : quote}`));
}

/** What checking a manifest's exports against its references found, and how many specifiers it checked. */
type ExportFindings = { findings: string[]; checked: number };

/** One finding per specifier no reference text names, and one when the manifest lacks the references export. */
export function exportFindings(
  dir: string,
  manifest: { name?: string | undefined; exports?: Json | undefined },
  references: string,
): ExportFindings {
  const specifiers = specifiersOf(manifest.name ?? "", manifest.exports);
  const findings = specifiers.filter((one) => !named(references, one)).map((one) => unnamedExport(one.shown, dir));

  if (!exportKeys(manifest.exports).includes(REFERENCES_EXPORT)) findings.push(noReferencesExport(dir));

  return { checked: specifiers.length, findings };
}
