import { mergeConfig, type UserWorkspaceConfig, type ViteUserConfig } from "vitest/config";

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

/** A root vitest config: the project defaults plus istanbul coverage, overridden by `config`. */
export function defineConfig(config: ViteUserConfig): ViteUserConfig {
  const defaults: ViteUserConfig = mergeConfig(projectDefaults(), { test: { coverage: { provider: "istanbul" } } });
  return mergeConfig(defaults, config);
}
