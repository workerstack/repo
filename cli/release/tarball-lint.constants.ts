/** The resolution kinds attw reports that an ESM-only package cannot satisfy (the CLI's `esm-only` profile). */
export const ESM_ONLY_IGNORED: readonly string[] = ["node10", "node16-cjs"];
export const MODULE_TYPE: string = "module";
export const REQUIRE_CONDITION: string = "require";
export const PUBLINT_LEVEL = "suggestion" as const;

const RESOLUTION_NAMES: Readonly<Record<string, string>> = {
  "node16-cjs": "node16 (from CJS)",
  "node16-esm": "node16 (from ESM)",
};

export function publintLine(formatted: string): string {
  return `publint: ${formatted}`;
}

/** One attw problem: where it was found (when it names a place), what it is and its kind. */
export type AttwFinding = {
  entrypoint?: string | undefined;
  resolution?: string | undefined;
  why: string;
  kind: string;
};

export function attwLine({ entrypoint, resolution, why, kind }: AttwFinding): string {
  const under = resolution === undefined ? "" : ` under ${RESOLUTION_NAMES[resolution] ?? resolution}`;

  return `attw: ${entrypoint ?? "package"}${under}: ${why} (${kind})`;
}
