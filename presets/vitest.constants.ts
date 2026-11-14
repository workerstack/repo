/** The wrangler files a Worker package may have, in the order the preset looks for them. */
export const WRANGLER_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"] as const;

/** The package that runs tests in the Workers runtime. */
export const PLUGIN_PACKAGE = "@cloudflare/vitest-plugin";

/** The plugin range the preset is written against. */
export const PLUGIN_RANGE = "^1.6.0";

/** The prefix every message from the preset starts with. */
export const MESSAGE_PREFIX = "@workerstack/repo/vitest";

/** The guard module's name, without the extension of the module that points at it. */
export const GUARD_NAME = "temp-root";

/** The error code `import()` gives a package it cannot find. */
export const NOT_FOUND = "ERR_MODULE_NOT_FOUND";

/** The question vite ends its error with when a bare import resolves to no installed package. */
export const NOT_INSTALLED = "Is it installed?";

/** The value of `REPO_COVERAGE` that `repo ci --no-coverage` sets for the packages' runs. */
export const COVERAGE_OFF = "0";

/** The value of `REPO_COVERAGE` that turns the packages' coverage on. */
export const COVERAGE_ON = "1";

/** The reporters a package's run uses when `repo ci --report` asks for its json report. */
export const REPORT_REPORTERS: readonly string[] = ["default", "json"];

/** A test or hook's timeout on Windows, whose runner spawns bun and git 25-35x slower than Linux. */
export const WINDOWS_TIMEOUT: number = 60_000;

/** A `REPO_VITEST_TIMEOUT` value: a positive whole number of milliseconds. */
export const WHOLE_MS_RE: RegExp = /^[1-9]\d*$/u;

/** A test or hook's timeout on every other platform. */
export const DEFAULT_TIMEOUT: number = 5_000;
