/** The stock skills that took a `-deep` name, by their old name. */
export const SKILL_RENAMES: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["write-plan", "write-plan-deep"],
  ["write-roadmap", "write-roadmap-deep"],
  ["implement-plan", "implement-plan-deep"],
  ["implement-roadmap", "implement-roadmap-deep"],
]);

/**
 * One old skill name as a whole word: `/write-plan` and `implement-plan 4` match, `write-plan-fast` and
 * `rewrite-plan` do not.
 */
export const OLD_SKILL_NAME: RegExp = /(?<![\w-])(?:write|implement)-(?:plan|roadmap)(?![\w-])/g;
