/** `repo yolo`'s manifest path, overlay dir, flags and actions. */

/** The stock manifest, under the package root. */
export const MANIFEST_REL = "agents/global-settings/manifest.json";

/** Under a consumer root: payloads of the stock names that replace the stock ones whole. */
export const OVERLAY_DIR = ".repo/global-settings";

/** The `--host` value that names every host. */
export const ALL_HOSTS = "all";
export const JSON_FORMAT = "json";
export const JSON_EXT = ".json";
export const TOML_FORMAT = "toml";
export const ENOENT = "ENOENT";
export const JSON_INDENT = 2;

export const DRY_RUN_FLAG = "--dry-run";
export const CHECK_FLAG = "--check";
export const HOST_FLAG = "--host";
export const HOST_PREFIX = "--host=";
export const UNKNOWN_HOST = "unknown host: ";
export const APPLY = "apply";
export const DRY_RUN = "dry-run";

/** A host's report action when its dest is left as it is. */
export const SKIP = "skip";

/** A host's `--check` state when its dest holds every payload key. */
export const OK_STATE = "ok";
