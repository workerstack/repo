/** The names `repo check` and the env-in-config rule compare against. */

/** The one module of a package that reads the process environment. */
export const ENV_FILE = "env.ts";
/** The file that marks a folder as a package. */
export const MANIFEST = "package.json";
/** The property that carries the environment on `process`, `Bun` and `import.meta`. */
export const ENV_PROPERTY = "env";
/** The keyword of `import.meta`. */
export const IMPORT_KEYWORD = "import";

/** The folder under HOME that holds each repo's age identity, one `<repo>.key` file per repo. */
export const KEYS_DIR = ".workerstack/keys";
/** The extension of an age identity file under KEYS_DIR. */
export const KEY_EXTENSION = ".key";
/** A repo's env keys file: its age recipient and its name, at the repo root. */
export const KEYS_FILE = ".repo/env.keys.json";
/** The variable that holds an age identity, read before any key file. */
export const ENV_KEY_VARIABLE = "WORKERSTACK_ENV_KEY";
/** The variable that names the current scope of a defineEnv file. */
export const SCOPE_VARIABLE = "REPO_ENV";
/** The package whose root holds the decrypt module. */
export const PACKAGE_NAME = "@workerstack/repo";
/** The module the decrypt child imports, relative to the package root: the shipped source, from cli/ and dist alike. */
export const DECRYPT_MODULE = "cli/env/age.ts";
/** The decrypt child's exit code when a cipher was sealed for a key it was not given. */
export const DECRYPT_WRONG_KEY_EXIT = 3;
/** The decrypt child's exit code for any other failure. */
export const DECRYPT_FAILED_EXIT = 1;
/** The user agent of a Cloudflare Worker, where `ctx.env` holds the values and defineEnv refuses to run. */
export const WORKER_USER_AGENT = "Cloudflare-Workers";
