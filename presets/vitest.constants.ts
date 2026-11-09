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
/** The package the guard loads in the runner process, which vitest must inline there. */
export const INLINED_PACKAGE = "zod";
/** The error code `import()` gives a package it cannot find. */
export const NOT_FOUND = "ERR_MODULE_NOT_FOUND";
/** The question vite ends its error with when a bare import resolves to no installed package. */
export const NOT_INSTALLED = "Is it installed?";
