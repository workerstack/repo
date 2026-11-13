import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CONFIG_FILE, COPY_ID_BYTES } from "./config.constants.ts";

/**
 * Imports the config module of `root`; `loadConfig` takes another in tests, whose runner resolves packages its own
 * way.
 */
export type ImportConfig = (root: string) => Promise<ConfigModule>;

/** A config file's module namespace; `loadConfig` reads only its default export. */
export type ConfigModule = {
  /** The config `defineConfig` returned; `loadConfig` parses it and refuses a module without one. */
  readonly default?: unknown;
};

/** The module namespace of the file at `file`. */
async function importFile(file: string): Promise<ConfigModule> {
  const namespace: unknown = await import(/* @vite-ignore */ pathToFileURL(file).href);

  return namespace /* an import resolves to its module namespace object */ as ConfigModule;
}

/** The module of a config whose text changed since it was loaded, imported from a temporary copy beside it. */
async function importCopy(root: string, file: string): Promise<ConfigModule> {
  const copy = path.join(root, `.repo.config.${randomBytes(COPY_ID_BYTES).toString("hex")}.ts`);
  fs.copyFileSync(file, copy);

  try {
    return await importFile(copy);
  } finally {
    fs.rmSync(copy, { force: true });
  }
}

/**
 * The config importer. A module is cached by path for the life of the process (a query string does not bust that
 * cache), so it keeps each config file's last loaded text and module, and a file whose text changed since it was
 * loaded is imported from a temporary copy beside it (same imports resolve, new path). A first load, or an unchanged
 * file, writes nothing.
 */
function cachedImporter(): ImportConfig {
  const loaded = new Map<string, { text: string; module: ConfigModule }>();

  return async (root) => {
    const file = path.join(root, CONFIG_FILE);
    const text = fs.readFileSync(file, "utf8");
    const known = loaded.get(file);

    if (known?.text === text) return known.module;
    const module = known === undefined ? await importFile(file) : await importCopy(root, file);
    loaded.set(file, { module, text });

    return module;
  };
}

/** Imports the config module of `root`, `loadConfig`'s default. */
export const importConfig: ImportConfig = /* @__PURE__ */ cachedImporter();
