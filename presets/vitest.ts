import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type UserWorkspaceConfig, type ViteUserConfig } from "vitest/config";
import { readEnv } from "../cli/env.ts";
import { rootEnv } from "./temp-root-env.ts";
import {
  COVERAGE_OFF,
  COVERAGE_ON,
  GUARD_NAME,
  INLINED_PACKAGE,
  REPORT_REPORTERS,
  WRANGLER_FILES,
} from "./vitest.constants.ts";
import { workersPlugin } from "./workers-plugin.ts";

/** Where `defineConfig` looks for the per-file floors `repo coverage` writes, relative to the cwd. */
const DEFAULT_FLOORS = "coverage-floors.json";

/** The temp root guard beside this module, with this module's own extension: `.ts` from source, `.js` from dist. */
function guardPath(): string {
  const self = fileURLToPath(import.meta.url);
  return path.join(path.dirname(self), `${GUARD_NAME}${path.extname(self)}`);
}

/** The project root vitest will use: the config's own, else the cwd. */
function rootOf(config: UserWorkspaceConfig): string {
  return path.resolve(config.test?.root ?? config.root ?? process.cwd());
}

/** The first wrangler file in `root`, or none for a package that is not a Worker. */
function wranglerFile(root: string): string | undefined {
  return WRANGLER_FILES.find((name) => fs.existsSync(path.join(root, name)));
}

// A Windows runner spawns bun and git 25-35x slower than Linux. The platform is read per call, not at module
// load, so one OS can exercise both branches.
function projectDefaults(config: UserWorkspaceConfig): UserWorkspaceConfig {
  const timeout = process.platform === "win32" ? 60_000 : 5_000;
  const root = rootOf(config);
  const file = wranglerFile(root);
  // Bun module namespaces carry `__esModule`, so vitest's default interop would swap a namespace for its default.
  const test = { testTimeout: timeout, hookTimeout: timeout, deps: { interopDefault: false } };
  if (file === undefined) return { test: { ...test, pool: "forks" } };
  // The Workers pool is the plugin's; a forks default would take the tests back to node.
  const configPath = path.join(root, file);
  return { plugins: [workersPlugin(configPath)], test };
}

/**
 * What `repo ci` asks of a package's run through the environment, read per call: `REPO_COVERAGE=1` turns coverage on,
 * `0` off and anything else leaves it to the config, and `REPO_VITEST_REPORT` adds the json reporter, writing to that file.
 */
function ciEnv(coverage: string | undefined): ViteUserConfig {
  const { REPO_VITEST_REPORT: report } = readEnv();
  return {
    test: {
      ...(coverage === COVERAGE_ON || coverage === COVERAGE_OFF
        ? { coverage: { enabled: coverage === COVERAGE_ON } }
        : {}),
      ...(report ? { reporters: [...REPORT_REPORTERS], outputFile: { json: report } } : {}),
    },
  };
}

/**
 * A package's vitest project: the shared timeouts and the forks pool, or the Workers runtime beside a wrangler file.
 * `repo ci` asks for coverage through the environment: `REPO_COVERAGE=1` turns it on (istanbul, as `defineConfig`
 * uses, unless the config names a provider) so the package's thresholds run, `0` turns it off, and `--report` adds the
 * json report the skip check reads. Without the variables the config is the caller's.
 */
export function defineProject(config: UserWorkspaceConfig): UserWorkspaceConfig {
  const { REPO_COVERAGE: coverage } = readEnv();
  const provider: ViteUserConfig = coverage === COVERAGE_ON ? { test: { coverage: { provider: "istanbul" } } } : {};
  const defaults: ViteUserConfig = mergeConfig(projectDefaults(config), provider);
  const merged: ViteUserConfig = mergeConfig(mergeConfig(defaults, config), ciEnv(coverage));
  // The run's own options sit beside the project ones: a package's run is the root run of its own vitest.
  return merged /* coverage and reporters are root options the project type leaves out */ as UserWorkspaceConfig;
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
export function defineConfig(
  config: ViteUserConfig,
  options: {
    /** The coverage floors file to read, relative to the cwd; defaults to `coverage-floors.json`. */
    floors?: string;
  } = {},
): ViteUserConfig {
  const thresholds = readFloors(options.floors ?? DEFAULT_FLOORS);
  const coverage = { provider: "istanbul", ...(Object.keys(thresholds).length > 0 ? { thresholds } : {}) } as const;
  // The guard loads cli/env.ts in the runner process, where an external zod loses its named exports.
  const guard = { globalSetup: [guardPath()], server: { deps: { inline: [INLINED_PACKAGE] } }, coverage };
  // Only test processes get the root: the runner's own tooling (miniflare) makes and removes temp dirs of its own.
  const defaults: ViteUserConfig = mergeConfig(projectDefaults(config), { test: { ...guard, env: rootEnv() } });
  return mergeConfig(defaults, config);
}
