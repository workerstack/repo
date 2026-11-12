/** The consumer's own env loader, when the repo ships one. */
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Load the consumer's root `scripts/lib/env.mjs` `loadEnv` when it exists (this script is under `cli/scripts/`). */
export async function loadOptionalConsumerEnv(baseHref: string | URL = import.meta.url): Promise<boolean> {
  const file = fileURLToPath(new URL("../../scripts/lib/env.mjs", baseHref));

  if (!fs.existsSync(file)) return false;

  const { loadEnv } = (await import(pathToFileURL(file).href)) /* a dynamic import has no static type */ as {
    loadEnv?: () => void;
  };

  if (typeof loadEnv === "function") loadEnv();

  return true;
}
