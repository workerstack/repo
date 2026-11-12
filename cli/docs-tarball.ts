import { group } from "./docs-fences.ts";
import { LINE_BREAK, notPacked, packFailed } from "./docs.constants.ts";
import type { Captured } from "./scripts/lint.ts";

/** Runs `bun pm pack --dry-run --ignore-scripts` in a package folder, captured. */
export type Pack = (cwd: string) => Captured;

/** A listed file or INDEX a package must carry: its path from the package folder and the INDEX that wants it. */
export type Wanted = { file: string; index: string };

const PACKED = /^packed\s+\S+\s+(.+?)\s*$/;
const ESCAPE_CODE = 0x1b;

/** `output` without the colors that survive a tool's own detection. */
function stripColors(output: string): string {
  return output.replaceAll(new RegExp(`${String.fromCodePoint(ESCAPE_CODE)}\\[[\\d;]*m`, "g"), "");
}

/** The paths in `packed {size} {path}` lines, with POSIX separators. */
export function packedPaths(output: string): Set<string> {
  const paths = new Set<string>();

  for (const line of stripColors(output).replaceAll("\\", "/").split(LINE_BREAK)) {
    const match = PACKED.exec(line);

    if (match !== null) paths.add(group(match, 1));
  }

  return paths;
}

/**
 * One finding per wanted file the dry-run tarball of the package at `dir` ("" for the root) lacks, where a missing
 * INDEX stands for the files it lists. `pack` runs in that folder and `wanted` holds root-relative paths; the tarball
 * lists paths from the package folder. A failed pack is one finding.
 */
export function tarballFindings(dir: string, wanted: readonly Wanted[], pack: () => Captured): string[] {
  const packed = pack();

  if (packed.code !== 0)
    return [packFailed(dir, packed.code, `${packed.stderr}${packed.stdout}`.trim().split(LINE_BREAK, 1).join(""))];
  const held = packedPaths(packed.stdout);
  const prefix = dir === "" ? "" : `${dir}/`;
  const missing = wanted.filter(({ file }) => !held.has(file.slice(prefix.length)));
  const lostIndexes = new Set(missing.filter(({ file, index }) => file === index).map(({ file }) => file));

  return missing
    .filter(({ file, index }) => file === index || !lostIndexes.has(index))
    .map(({ file, index }) => notPacked(file, index, dir));
}
