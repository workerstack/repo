import type { MissingTypes } from "./type-surface-entries.ts";

/** The manifest a line names: the root's, or a workspace package's under its dir. */
const MANIFEST_FILE = "package.json";

/** The dir key the root's surface is kept under. */
export const ROOT_DIR = ".";

const MOVE = 'move it to "peerDependencies" and "devDependencies"';

/** Where an exposed dep is used: the export key whose types reach the file, when one does, and the file. */
export type Exposure = { name: string; key: string | undefined; file: string };

/** The line for a dep the exported types use. */
export function exposedDep(manifest: string, { name, key, file }: Exposure): string {
  const types = key === undefined ? "the exported types" : `the types of "${key}"`;

  return `${manifest}: ${name} is in "dependencies" but ${types} use it (${file}); ${MOVE} keeping its version`;
}

/** The line for any other dep of a public package without `bin`. */
export function libraryDep(manifest: string, name: string): string {
  return `${manifest}: ${name} is in "dependencies" of a library (no "bin"); bundle it, or ${MOVE}`;
}

/** The manifest a package's lines name, from its dir key. */
export function manifestFileOf(dir: string): string {
  return dir === ROOT_DIR ? MANIFEST_FILE : `${dir}/${MANIFEST_FILE}`;
}

const BUILD_FIRST = 'build first or point "types" at the source';

/**
 * The line for an export whose types file is absent: a source target that is gone, a declaration target no
 * tsconfig.build.json maps to a source, or one tsconfig.build.json emits nothing to.
 */
export function missingTypes(manifest: string, { cause, key, types }: MissingTypes): string {
  const missing = `${manifest}: the types of "${key}" (${types}) are missing`;

  if (cause === "source") return `${missing}; restore the file or drop the export`;

  if (cause === "unmapped") return `${missing} and no tsconfig.build.json maps them to a source; ${BUILD_FIRST}`;

  return `${missing} and no source in tsconfig.build.json emits them; ${BUILD_FIRST}`;
}

/** The line for a public package whose export types could not be read. */
export function surfaceUnreadable(manifest: string, message: string): string {
  return `${manifest}: could not read the types of its exports (${message})`;
}
