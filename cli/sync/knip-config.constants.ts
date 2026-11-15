/** The schema the generated knip config points editors at. */
export const KNIP_SCHEMA_URL = "https://unpkg.com/knip@6/schema.json";

/** The spaces the generated knip config is indented by. */
export const KNIP_JSON_INDENT = 2;

/**
 * The files tools load by name (`*.config.ts`) or from a path a config names (a Cloudflare Worker's `*.worker.ts`):
 * nothing imports them, so every workspace makes them entries.
 */
export const TOOL_LOADED_ENTRIES: readonly string[] = ["**/*.config.ts", "**/*.worker.ts"];
