/** Env names the outer bun, npm, CI or vitest set, which a sandbox never passes on. */
export const INHERITED_ENV = /^(npm_|bun_|init_cwd$|ci$|github_actions$|continuous_integration$|vitest)/i;

/** How long one sandbox command may run before it is killed. */
export const RUN_TIMEOUT_MS = 600_000;

/** Real executables, which run without a shell on Windows; every other command is a .cmd shim that needs one. */
export const NATIVE_EXES: ReadonlySet<string> = /* @__PURE__ */ new Set([process.execPath, "bash", "git"]);

/** Errors a module that fails to resolve or load prints. */
const LOAD_ERRORS = "ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|ERR_REQUIRE_ESM|ERR_UNKNOWN_FILE_EXTENSION";
/** Errors code that loaded but is broken prints. */
const CODE_ERRORS = "SyntaxError|ReferenceError|TypeError: .* is not a function";
/** Output that shows the installed package failed to load or run. */
export const BROKEN_RUNTIME: Readonly<RegExp> = /* @__PURE__ */ new RegExp(`${LOAD_ERRORS}|${CODE_ERRORS}`);
