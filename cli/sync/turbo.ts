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

/** The generated `turbo.json` text: `typecheck` and `test`, then the config's `turbo.tasks`. */
function turboText(ctx: SyncContext): string {
  const config = {
    $schema: TURBO_SCHEMA_URL,
    globalDependencies: GLOBAL_DEPENDENCIES,
    tasks: { typecheck: TYPECHECK_TASK, test: TEST_TASK, ...ctx.config.turbo?.tasks },
  };
  return `${JSON.stringify(config, null, TURBO_JSON_INDENT)}\n`;
}

/**
 * Under the workspace pack, the untracked, schema-checked `turbo.json`. JSON has no header, so a file already there
 * is sync's when it is what sync would write or the sync manifest lists it as written last run; any other is
 * hand-written and refused.
 */
export const turbo: Generator = (ctx) => {
  if (!ctx.config.packs.includes("workspace")) return { outputs: [], errors: [] };
  const content = turboText(ctx);
  const existing = ctx.read(TURBO_CONFIG_PATH);
  const ours = existing === content || readManifest(ctx.root).paths.includes(TURBO_CONFIG_PATH);
  if (existing !== null && !ours) return { outputs: [], errors: [TURBO_REFUSAL] };
  return {
    outputs: [{ kind: "file", path: TURBO_CONFIG_PATH, content, tracked: false, managed: "whole" }],
    errors: [],
  };
};
