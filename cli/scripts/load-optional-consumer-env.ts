/** The consumer's own env loader, when the repo ships one. */
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** True for a consumer module that exports a callable `loadEnv`. */
function hasLoader(mod: unknown): mod is { loadEnv: () => void } {
  return typeof mod === "object" && mod !== null && "loadEnv" in mod && typeof mod.loadEnv === "function";
}

/** Load the consumer's root `scripts/lib/env.mjs` `loadEnv` when it exists (this script is under `cli/scripts/`). */
export async function loadOptionalConsumerEnv(baseHref: string | URL = import.meta.url): Promise<boolean> {
  const file = fileURLToPath(new URL("../../scripts/lib/env.mjs", baseHref));

  if (!fs.existsSync(file)) return false;

  const mod: unknown = await import(pathToFileURL(file).href);

  if (hasLoader(mod)) mod.loadEnv();

  return true;
}
