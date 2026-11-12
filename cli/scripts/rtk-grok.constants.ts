/** How long `rtk rewrite` may run before the hook gives up on it. */
export const RTK_TIMEOUT_MS: number = 3000;

/** The rtk binary's name, and the first word of a command already routed through it. */
export const RTK_BIN = "rtk";

/** The flag that makes an rtk subcommand print its most compact output. */
export const ULTRA_FLAG = "--ultra-compact";

/** The rtk subcommands that take `--ultra-compact`. */
export const ULTRA_SUBS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "grep",
  "rg",
  "curl",
  "wget",
  "vitest",
  "jest",
  "pytest",
  "test",
  "lint",
  "tsc",
  "npm",
  "npx",
  "read",
  "find",
  "diff",
  "json",
  "log",
  "playwright",
  "cargo",
  "ruff",
  "prettier",
  "format",
]);

/** Where a command's first word ends: the first whitespace, or the end. */
export const WORD_END: RegExp = /\s|$/;

/** A command of a binary, a subcommand and maybe the rest. */
export const RTK_CALL: RegExp = /^(?<bin>\S+)\s+(?<sub>\S+)(?:\s+(?<rest>[\s\S]*))?$/;
