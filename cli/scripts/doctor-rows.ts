/** One doctor row's layout, and the `globals` and `maps` rows, which read the package and the checkout. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INDEX_REL } from "../sync/maps.constants.ts";
import { sectionBody } from "../sync/maps.ts";
import { isSelf } from "../sync/stock.ts";
import type * as checkGlobalsModule from "./check-globals.ts";
import { GLOBALS_MANIFEST_REL, MAPS_SECTIONS, ROW_PAD } from "./doctor.constants.ts";

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function row(name: string, status: string, extra: string = ""): string {
  const a = name.padEnd(ROW_PAD);
  const b = status.padEnd(ROW_PAD);
  const c = extra.trim();

  return c === "" ? `${a} ${b}` : `${a} ${b} ${c}`;
}

/** The package's own root, two levels above `cli/scripts/`: where the stock globals live. */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * One `globals` row from checkGlobals: ok, the first drift line, or the check error. Null when the
 * repo ships no manifest. check-globals needs smol-toml, which setup.ts (it imports the doctor modules)
 * must run without, so the `load` option brings it in on demand instead of at import; a test passes a loader
 * that rejects.
 */
export async function globalsRow(
  cwd: string | undefined,
  home: string | undefined,
  {
    sourceRoot = packageRoot(),
    load = () => import("./check-globals.ts"),
  }: { sourceRoot?: string; load?: () => Promise<typeof checkGlobalsModule> } = {},
): Promise<string | null> {
  if (!fs.existsSync(path.join(sourceRoot, GLOBALS_MANIFEST_REL))) return null;
  let mod: typeof checkGlobalsModule;

  try {
    mod = await load();
  } catch (err) {
    return row("globals", "unavailable", `${errorText(err).split("\n")[0]}; run bun install`);
  }

  const r = mod.checkGlobals({
    sourceRoot,
    ...(home === undefined ? {} : { home }),
    ...(cwd === undefined ? {} : { workspaceRoot: cwd }),
  });

  return checkedRow(mod, r);
}

/** The `globals` row of a finished check: ok, its first drift line, or its error. */
function checkedRow(mod: typeof checkGlobalsModule, r: checkGlobalsModule.CheckResult): string {
  if (r.ok) return row("globals", "ok");
  const first = r.drift?.[0]; // drift is only set when non-empty

  return row(
    "globals",
    first === undefined ? (r.error /* a failed check sets drift or error */ as string) : mod.driftLine(first),
  );
}

/**
 * The `maps` row: null outside `@workerstack/repo`; otherwise ok when `references/INDEX.md` has both generated
 * marker pairs.
 */
export function mapsRow(root: string): { line: string; ok: boolean } | null {
  if (!isSelf(root)) return null;
  const fix = "run bun repo sync";
  let text: string;

  try {
    text = fs.readFileSync(path.join(root, INDEX_REL), "utf8");
  } catch {
    return { line: row("maps", "missing", `${INDEX_REL} is missing; ${fix}`), ok: false };
  }

  const absent = MAPS_SECTIONS.find((name) => sectionBody(text, name) == null);

  if (absent !== undefined)
    return { line: row("maps", "missing", `${INDEX_REL} has no repo:${absent} section; ${fix}`), ok: false };

  return { line: row("maps", "ok", `${INDEX_REL} ${MAPS_SECTIONS.map((n) => `repo:${n}`).join(", ")}`), ok: true };
}
