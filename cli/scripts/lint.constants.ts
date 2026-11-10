/** The prefix of the variables git hands a hook (GIT_DIR, GIT_INDEX_FILE, ...). */
export const GIT_ENV_PREFIX = "GIT_";
/** Env-config variables: they set config, not the repo, so a tool keeps them. */
export const GIT_CONFIG_ENV: RegExp = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/;
