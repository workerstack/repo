/** The names and thresholds `repo check` holds a defineEnv file's values against. */

/** The text a file must hold to be scanned: a call of defineEnv. */
export const DEFINE_ENV_CALL: string = "defineEnv(";

/** The function that declares an env. */
export const DEFINE_ENV: string = "defineEnv";

/** The block of process variables a defineEnv file reads. */
export const PROCESS_BLOCK: string = "process";

/** The blocks of plain values, in the order lines name them. */
export const VALUE_BLOCKS: readonly string[] = ["global", "local", "dev", "prod"];

/** The scope blocks that must hold the same keys. */
export const SCOPE_BLOCKS: readonly string[] = ["local", "dev", "prod"];

/** The extensions of the files the check parses. */
export const SCANNED_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts"];

/** Prefixes of values public by design: Stripe publishable keys, shipped to browsers, are never secrets. */
export const PUBLIC_PREFIXES: readonly string[] = ["pk_live_", "pk_test_"];

/** Prefixes that mark a value as a provider's secret. */
export const SECRET_PREFIXES: readonly string[] = [
  "sk_",
  "ghp_",
  "github_pat_",
  "npm_",
  "cfat_",
  "cfk_",
  "AIza",
  "whsec_",
  "sk-ant-",
  "GOCSPX-",
];

/** A value holding a URL scheme: an address, never a token, even with a token's characters. */
export const URL_MARK: string = "://";

/** The shape a random token takes: base64, base64url or an OAuth secret's `.~:` set, at least 20 characters. */
export const TOKEN_SHAPE: Readonly<RegExp> = /^[\w+/=.~:-]{20,}$/u;

/** An upper-case letter; a random token mixes both cases, which no hex id, UUID, domain or slug does. */
export const UPPER: Readonly<RegExp> = /[A-Z]/u;

/** A lower-case letter; a random token mixes both cases. */
export const LOWER: Readonly<RegExp> = /[a-z]/u;

/** A letter, which a value under a credential name holds alongside a digit. */
export const LETTER: Readonly<RegExp> = /[a-z]/iu;

/** A digit, which a random token holds alongside its letters. */
export const DIGIT: Readonly<RegExp> = /\d/u;

/**
 * The Shannon entropy, in bits per character, at or above which a mixed-case token counts as random. Set from the
 * monorepo's sealed values: a 22-character base62 code measures 3.97, so 4 missed it.
 */
export const ENTROPY_BITS: number = 3.5;

/** The reason a mixed-case token of high entropy is flagged. */
export const ENTROPY_REASON: string = "high entropy";

/**
 * A key named for a credential: a TOKEN, SECRET, PASSWORD or PASSWD segment, or a name ending `_KEY`. Under it a
 * single-case hex key, a UUID token or a base32 TOTP secret, which no value rule tells from an id, is a secret.
 */
export const CREDENTIAL_NAME: Readonly<RegExp> = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD)(?:_|$)|_KEY$/u;

/** The shape a value under a credential name takes to be flagged: no space, at least 16 characters. */
export const CREDENTIAL_SHAPE: Readonly<RegExp> = /^\S{16,}$/u;

/** The reason a value under a credential name is flagged. */
export const CREDENTIAL_REASON: string = "credential name";

/** The fix a plaintext secret's line names. */
export const SEAL_HINT: string = 'seal it: sealed("<base64 of `age -r <recipient in .repo/env.keys.json>`>")';
