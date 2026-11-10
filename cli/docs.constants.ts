export const DOCS_SUMMARY =
  "Check references: index, links, exports, examples, tarball (--check: only check; else sync first)";
export const DOCS_USAGE = "usage: repo docs [--check]";
export const FLAG_CHECK = "--check";
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export const REFERENCES_DIR = "references";
export const INDEX_FILE = "INDEX.md";
export const MARKDOWN_EXT = ".md";
export const INSTALLED_DIR = "node_modules/";
const MANIFEST_FILE = "package.json";
export const TSCONFIG_FILE = "tsconfig.json";
export const PACK_ARGS: readonly string[] = ["pm", "pack", "--dry-run", "--ignore-scripts"];
export const SCRATCH_DIR = ".tmp/repo/docs";
export const REFERENCES_EXPORT = "./references/*";
export const SKIPPED_EXPORTS: readonly string[] = ["./package.json", REFERENCES_EXPORT];

/** A path as the doc root's package sees it: under its directory, which is empty for the repo root. */
export function under(dir: string, rel: string): string {
  return dir === "" ? rel : `${dir}/${rel}`;
}

function where(dir: string): string {
  return dir === "" ? "." : dir;
}

export function unlisted(file: string, index: string): string {
  return `${file} is not listed in ${index}; add a line that links it`;
}

export function noIndex(file: string, index: string): string {
  return `${file} is not listed in ${index}, which does not exist; add it with a line that links the file`;
}

export function brokenLink(at: string, target: string): string {
  return `${at}: links ${target}, which does not exist`;
}

export function missingPackage(at: string, target: string, name: string): string {
  return `${at}: links ${target}, but ${name} is not installed; add it or drop the link`;
}

export function unnamedExport(specifier: string, dir: string): string {
  return `${specifier} is exported but no reference names it; document it in ${under(dir, "references/")}`;
}

export function noReferencesExport(dir: string): string {
  return `${under(dir, MANIFEST_FILE)} has no "${REFERENCES_EXPORT}" export; add "${REFERENCES_EXPORT}": "${REFERENCES_EXPORT}"`;
}

export function notPacked(file: string, index: string, dir: string): string {
  const fix = `add "references" to files in ${under(dir, MANIFEST_FILE)}`;
  return file === index
    ? `${file} is not in the packed tarball; ${fix}`
    : `${file} is listed in ${index} but not in the packed tarball; ${fix}`;
}

export function packFailed(dir: string, code: number, detail: string): string {
  return `bun pm pack failed in ${where(dir)} (exit ${code}): ${detail}`;
}

export function buildFailed(dir: string, code: number, detail: string): string {
  return `bun run build failed in ${where(dir)} (exit ${code}), so its examples were not checked: ${detail}`;
}

export function typeError(at: string, example: number, detail: string): string {
  return `${at}: example ${example} fails to type-check: ${detail}`;
}

export function typecheckCrash(dir: string, detail: string): string {
  return `tsc failed in ${where(dir)}: ${detail}`;
}

export function runError(at: string, example: number, exit: { code: number; detail: string }): string {
  return `${at}: example ${example} fails to run (exit ${exit.code}): ${exit.detail}`;
}

export function okLine(counts: { references: number; examples: number; exports: number; packed: boolean }): string {
  const tail = counts.packed ? ", tarball holds references/" : "";
  return `docs ok: ${counts.references} references, ${counts.examples} examples, ${counts.exports} exports${tail}`;
}
