/** The schema the generated knip config points editors at. */
export const KNIP_SCHEMA_URL = "https://unpkg.com/knip@6/schema.json";

/** The spaces the generated knip config is indented by. */
export const KNIP_JSON_INDENT = 2;

/**
 * The suffixes of the files tools load by name (`*.config.ts`) or from a path a config names (a Cloudflare Worker's
 * `*.worker.ts`): nothing imports them, so each workspace makes the ones git lists in it entries.
 */
export const TOOL_LOADED_SUFFIXES: readonly string[] = [".config.ts", ".worker.ts"];

/**
 * The entries standing for those files outside git, where no listing exists and no `.gitignore` applies. Inside git
 * they would reach gitignored files too, since knip applies `.gitignore` to its project files but not to entry globs.
 */
export const TOOL_LOADED_GLOBS: readonly string[] = ["**/*.config.ts", "**/*.worker.ts"];
