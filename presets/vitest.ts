import fs from "node:fs";
import path from "node:path";
import { mergeConfig, type UserWorkspaceConfig, type ViteUserConfig } from "vitest/config";

/** Where `defineConfig` looks for the per-file floors `repo coverage` writes, relative to the cwd. */
const DEFAULT_FLOORS = "coverage-floors.json";

// A Windows runner spawns bun and git 25-35x slower than Linux. The platform is read per call, not at module
// load, so one OS can exercise both branches.
function projectDefaults(): UserWorkspaceConfig {
  const timeout = process.platform === "win32" ? 60_000 : 5_000;
  // Bun module namespaces carry `__esModule`, so vitest's default interop would swap a namespace for its default.
  return { test: { testTimeout: timeout, hookTimeout: timeout, pool: "forks", deps: { interopDefault: false } } };
}

/** A package's vitest project: the shared timeouts and the forks pool, overridden by `config`. */
export function defineProject(config: UserWorkspaceConfig): UserWorkspaceConfig {
  return mergeConfig(projectDefaults(), config);
}

/** The floors file's per-file thresholds, or none when the file is absent. */
function readFloors(file: string): Record<string, unknown> {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return {};
  try {
    const floors: unknown = JSON.parse(fs.readFileSync(full, "utf8"));
    return floors /* the floors file holds the thresholds object repo coverage wrote */ as Record<string, unknown>;
  } catch {
    throw new Error(`${full} is not valid JSON; run \`bun repo coverage\` to write it again`);
  }
}

/**
 * A root vitest config: the project defaults plus istanbul coverage, overridden by `config`. The floors file
 * (`coverage-floors.json` in the cwd, or `options.floors`) becomes per-file coverage thresholds; the caller's own
 * thresholds are merged over them, and a missing file adds none.
 */
export function defineConfig(config: ViteUserConfig, options: { floors?: string } = {}): ViteUserConfig {
  const thresholds = readFloors(options.floors ?? DEFAULT_FLOORS);
  const coverage = { provider: "istanbul", ...(Object.keys(thresholds).length > 0 ? { thresholds } : {}) } as const;
  const defaults: ViteUserConfig = mergeConfig(projectDefaults(), { test: { coverage } });
  return mergeConfig(defaults, config);
}
