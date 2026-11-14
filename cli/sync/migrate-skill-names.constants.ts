/** The stock skills that took a new name (`-deep`, and `do` to `rn`), by their old name. */
export const SKILL_RENAMES: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["write-plan", "write-plan-deep"],
  ["write-roadmap", "write-roadmap-deep"],
  ["implement-plan", "implement-plan-deep"],
  ["implement-roadmap", "implement-roadmap-deep"],
  ["do", "rn"],
]);

/**
 * One old skill name as a whole word: `/write-plan` and `implement-plan 4` match, `write-plan-fast` and
 * `rewrite-plan` do not.
 */
export const OLD_SKILL_NAME: RegExp = /(?<![\w-])(?:write|implement)-(?:plan|roadmap)(?![\w-])/g;

/**
 * The slash skill `/do` as a whole token: `/do`, `run /do now.` and `` `/do` `` match; `a/do`, `./do`, `https://x/do`,
 * `/docs`, `undo` and a bare `do` do not.
 */
export const SLASH_DO: RegExp = /(?<![\w./:-])\/do(?![\w/-]|\.\w)/g;

/** The file name of a skill's text. */
export const SKILL_FILE = "SKILL.md";

/** The `name: do` and `overrides: do` lines of a SKILL.md. */
export const DO_SKILL_LINE: RegExp = /^(name|overrides): do$/gm;
