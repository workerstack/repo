/** Root-relative directory of each source root: stock first, the consumer overlay second. */
export const STOCK_DIR = "agents";
export const CONSUMER_DIR = ".repo";
/** The hooks source each root may hold. */
export const HOOKS_FILE = "hooks.jsonc";
/** The doc kind that may scope itself with `paths` and must carry a `description`. */
export const RULES = "rules";
/** The extension of a doc file, and the pattern that strips it from a name. */
export const MD = ".md";
export const MD_SUFFIX: RegExp = /\.md$/;
/** The order a comparator returns for the first of two unequal names. */
export const BEFORE = -1;
export const AFTER = 1;
/** The frontmatter keys a rule may carry. */
export const RULE_KEYS: readonly string[] = ["description", "paths", "overrides"];
/** The frontmatter keys a subagent may carry beside one block per host. */
export const SUBAGENT_BASE_KEYS: readonly string[] = ["name", "description", "targets", "overrides", "tier", "exec"];
/** The most a rule or subagent body may hold; longer detail belongs in a skill or a reference. */
export const MAX_BODY_BYTES: number = 8 * 1024;
