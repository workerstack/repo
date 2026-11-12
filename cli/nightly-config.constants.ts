/** The limits and texts of the `nightly` config section. */

export const MIN_SHARDS = 1;
export const MAX_SHARDS = 32;

/** A secret name: upper-case letters, digits and underscores, not starting with a digit. */
export const SECRET_NAME: RegExp = /^[A-Z_][A-Z0-9_]*$/;

/** Names GitHub reserves for itself. */
export const RESERVED_PREFIX = "GITHUB_";
export const SHARDS_ERROR: string = `must be a whole number from ${MIN_SHARDS} to ${MAX_SHARDS}`;
const SECRET_HINT = "must be a secret name like CLOUDFLARE_API_TOKEN,";
export const SECRET_ERROR: string = `${SECRET_HINT} not starting with ${RESERVED_PREFIX}`;
export const SECRETS_ERROR = "must be a list of secret names";
export const SECTION_ERROR = "must be an object like { shards: 8, secrets: [...] }";
