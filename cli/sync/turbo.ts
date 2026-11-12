import type { TurboTask } from "../turbo-config.ts";
import { readManifest } from "./manifest.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import {
  GLOBAL_DEPENDENCIES,
  TEST_TASK,
  TURBO_CONFIG_PATH,
  TURBO_JSON_INDENT,
  TURBO_REFUSAL,
  TURBO_SCHEMA_URL,
  TYPECHECK_TASK,
} from "./turbo.constants.ts";

/** The `turbo.json` sync writes: the schema, the files every task keys on, and the tasks by name. */
export type TurboJson = { $schema: string; globalDependencies: readonly string[]; tasks: Record<string, TurboTask> };

/** The generated `turbo.json` text: `typecheck` and `test`, then the config's `turbo.tasks`. */
function turboText(ctx: SyncContext): string {
  const config: TurboJson = {
    $schema: TURBO_SCHEMA_URL,
    globalDependencies: GLOBAL_DEPENDENCIES,
    tasks: { test: TEST_TASK, typecheck: TYPECHECK_TASK, ...ctx.config.turbo?.tasks },
  };

  return `${JSON.stringify(config, null, TURBO_JSON_INDENT)}\n`;
}

/**
 * Under the workspace pack, the untracked, schema-checked `turbo.json`. JSON has no header, so a file already there
 * is sync's when it is what sync would write or the sync manifest lists it as written last run; any other is
 * hand-written and refused.
 */
export function turbo(ctx: SyncContext): ReturnType<Generator> {
  if (!ctx.config.packs.includes("workspace")) return { errors: [], outputs: [] };
  const content = turboText(ctx);
  const existing = ctx.read(TURBO_CONFIG_PATH);
  const ours = existing === content || readManifest(ctx.root).paths.includes(TURBO_CONFIG_PATH);

  if (existing !== null && !ours) return { errors: [TURBO_REFUSAL], outputs: [] };

  return {
    errors: [],
    outputs: [{ content, kind: "file", managed: "whole", path: TURBO_CONFIG_PATH, tracked: false }],
  };
}
