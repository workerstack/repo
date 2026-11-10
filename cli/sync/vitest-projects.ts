import { hasOwnedHeader } from "./header.ts";
import type { Generator } from "./outputs.ts";
import {
  PACKAGE_VITEST_CONFIG,
  VITEST_CONFIG_PATH,
  VITEST_IMPORT,
  VITEST_REFUSAL,
} from "./vitest-projects.constants.ts";

/**
 * Under the workspace pack, the untracked root `vitest.config.ts` listing each package's `vitest.config.ts` under
 * `projects`, in path order; a hand-written one is refused.
 */
export const vitestProjects: Generator = (ctx) => {
  if (!ctx.config.packs.includes("workspace")) return { outputs: [], errors: [] };
  const existing = ctx.read(VITEST_CONFIG_PATH);
  if (existing !== null && !hasOwnedHeader(existing)) return { outputs: [], errors: [VITEST_REFUSAL] };
  const projects = ctx.workspace.packages
    .map((pkg) => `${pkg.dir}/${PACKAGE_VITEST_CONFIG}`)
    .filter((rel) => ctx.read(rel) !== null);
  const body = `export default defineConfig({ test: { projects: ${JSON.stringify(projects)} } });`;
  const content = `${VITEST_IMPORT}\n${body}\n`;
  return {
    outputs: [{ kind: "file", path: VITEST_CONFIG_PATH, content, tracked: false, managed: "whole" }],
    errors: [],
  };
};
