import path from "node:path";

import type { ViteUserConfig } from "vitest/config";

import { MESSAGE_PREFIX, NOT_FOUND, NOT_INSTALLED, PLUGIN_PACKAGE, PLUGIN_RANGE } from "./vitest.constants.ts";

type Plugin = Exclude<NonNullable<ViteUserConfig["plugins"]>[number], Promise<unknown>>;

type CloudflareTest = (options: { wrangler: { configPath: string } }) => Plugin;

/** The plugin module as `import()` resolves it: a namespace whose `cloudflareTest`, if any, is not yet checked. */
type PluginModule = { readonly cloudflareTest?: unknown };

const installHint = `bun add -d ${PLUGIN_PACKAGE}`;

/**
 * True for the error `import()` gives when the plugin itself, not one of its own dependencies, is not installed:
 * node and bun give a code, and vite's module runner, which loads the preset under vitest, says so in the message.
 */
function isPluginMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message.includes(PLUGIN_PACKAGE)) return false;

  return ("code" in error && error.code === NOT_FOUND) || error.message.includes(NOT_INSTALLED);
}

function hasCloudflareTest(loaded: PluginModule): loaded is { cloudflareTest: CloudflareTest } {
  return typeof loaded.cloudflareTest === "function";
}

/** The plugin package, imported from the preset's own resolution scope, where an optional peer is linked. */
function importPlugin(): Promise<PluginModule> {
  const specifier: string = PLUGIN_PACKAGE;

  return import(specifier);
}

/**
 * The Workers plugin for the wrangler file at `configPath`, as a promise vite settles while it resolves the config;
 * the plugin is ESM only, so a synchronous `require` cannot load it. A plugin that is not installed becomes the line
 * that says how to install it, naming the wrangler file; a module without `cloudflareTest` is an error naming the
 * expected range; any other load error passes through unchanged.
 */
export async function workersPlugin(
  configPath: string,
  load: () => Promise<PluginModule> = importPlugin,
): Promise<Plugin> {
  let loaded: PluginModule;

  try {
    loaded = await load();
  } catch (error) {
    if (!isPluginMissing(error)) throw error;
    const file = path.basename(configPath);
    throw new Error(`${MESSAGE_PREFIX}: ${file} is here, so tests run in the Workers runtime; ${installHint}`, {
      cause: error,
    });
  }

  if (!hasCloudflareTest(loaded)) {
    throw new Error(
      `${MESSAGE_PREFIX}: ${PLUGIN_PACKAGE} does not export cloudflareTest; ${installHint}@${PLUGIN_RANGE}`,
    );
  }

  return loaded.cloudflareTest({ wrangler: { configPath } });
}
