import fs from "node:fs";
import path from "node:path";

import type { CompilerOptions } from "typescript/unstable/async";

import { configOf } from "./ts-api.ts";
import type { TsRun } from "./ts-api.ts";
import { posix } from "./ts-program.ts";
import { BUILD_CONFIG, DECLARATION, JSX_PRESERVE, TYPESCRIPT } from "./type-surface.constants.ts";

/**
 * A source's extension, and what tsc names its script and its declaration (null for none), and its script under
 * `jsx: preserve` when that differs.
 */
type Emit = { source: string; script: string; declaration: string | null; preserved?: string };

/** Each source extension tsc builds, longest first so `.d.ts` never reads as `.ts`. */
const EMITS: readonly Emit[] = [
  { declaration: ".d.mts", script: ".mjs", source: ".mts" },
  { declaration: ".d.cts", script: ".cjs", source: ".cts" },
  { declaration: ".d.ts", preserved: ".jsx", script: ".js", source: ".tsx" },
  { declaration: ".d.ts", script: ".js", source: ".ts" },
  { declaration: ".d.mts", script: ".mjs", source: ".mjs" },
  { declaration: ".d.cts", script: ".cjs", source: ".cjs" },
  { declaration: ".d.ts", script: ".jsx", source: ".jsx" },
  { declaration: ".d.ts", script: ".js", source: ".js" },
  { declaration: null, script: ".json", source: ".json" },
];

/** The script and declaration a source builds to, a `.tsx` kept as `.jsx` under `jsx: preserve`. */
function emitOf(source: string, options: Readonly<CompilerOptions>): Emit | undefined {
  const emit = EMITS.find((each) => source.endsWith(each.source));

  if (emit?.preserved === undefined || Number(options.jsx) !== JSX_PRESERVE) return emit;

  return { ...emit, script: emit.preserved };
}

/** The declaration tsc emits for a TypeScript source: its name with the declaration extension. */
export function declarationOf(source: string): string {
  return source.replace(TYPESCRIPT, ".d.$1ts");
}

/** The sources a declaration can be emitted from, in the order tsc prefers them: `.ts` before `.tsx` before `.js`. */
export function sourcesOf(declaration: string): string[] {
  return EMITS.flatMap((each) =>
    each.declaration !== null && declaration.endsWith(each.declaration)
      ? [`${declaration.slice(0, -each.declaration.length)}${each.source}`]
      : [],
  );
}

/** Where tsc writes an output of the source `stem`: under `out` by its path from `root`, or beside it with no `out`. */
function outputOf(stem: string, root: string, out: string | undefined): string {
  return out === undefined ? stem : path.posix.join(out, path.posix.relative(root, stem));
}

/**
 * What a package's tsconfig.build.json emits: each output file, script and declaration, with the source it is built
 * from, as TS 7's tsc names them: under `outDir` (declarations under `declarationDir` when set) by the path from
 * `rootDir`, which defaults to the config's dir, and beside the source with no `outDir`, where json is not copied.
 * Undefined when the package has no build config, or one that cannot be read or is not valid JSON.
 */
export async function buildOutputs(run: TsRun, dir: string): Promise<Map<string, string> | undefined> {
  const file = posix(path.join(dir, BUILD_CONFIG));

  if (!fs.existsSync(file)) return undefined;
  const read = await configOf(run, file);

  if (!read.ok) return undefined;
  const { options, fileNames } = read.value;
  const root = options.rootDir ?? posix(path.dirname(file));
  const outputs = new Map<string, string>();

  for (const source of fileNames.filter((name) => !DECLARATION.test(name))) {
    const emit = emitOf(source, options);

    if (emit === undefined) continue;
    const stem = source.slice(0, -emit.source.length);
    const declarations = options.declarationDir ?? options.outDir;

    if (emit.declaration !== null) outputs.set(`${outputOf(stem, root, declarations)}${emit.declaration}`, source);

    const script = `${outputOf(stem, root, options.outDir)}${emit.script}`;

    if (emit.declaration !== null || options.outDir !== undefined) outputs.set(script, source);
  }

  return outputs;
}
