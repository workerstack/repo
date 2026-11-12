/** The dir of a repo's own sync input, at the root and in a workspace package. */
export const REPO_DIR = ".repo";
/** The repo's own skills, one folder each. */
export const SKILLS_DIR: string = `${REPO_DIR}/skills`;
/** The longest a skill's `description` may be. */
export const MAX_DESCRIPTION_CHARS = 1024;

/** What a package `.repo/` may hold. */
export const PACKAGE_DIRS: readonly string[] = ["rules", "skills"];
/** The root `.repo/` dirs sync reads. */
export const READ_DIRS: readonly string[] = ["rules", "subagents", "skills", "lessons", "tmp", "global-settings"];
/** The root `.repo/` files sync reads. */
export const READ_FILES: readonly string[] = ["hooks.jsonc", "mcp-policy.jsonc", "permissions.json", "map.jsonc"];
/** Root `.repo/` dirs sync does not read, with who does: the bench specs `repo bench` runs. Root-only, like lessons. */
export const OTHER_READER_DIRS: ReadonlyArray<readonly [string, string]> = [["bench", "repo bench"]];
/** The `.repo/settings/` dir, which holds only the claude settings file. */
export const SETTINGS_DIR = "settings";
/** The one settings file `.repo/settings/` may hold. */
export const CLAUDE_SETTINGS_FILE = "claude.json";
/**
 * Files sync does not read, with who does: the lint baseline `repo turn` lowers and `repo check` holds the tree
 * to, and the test times `repo ci times` writes for the shard sequencer.
 */
export const OTHER_READERS: ReadonlyArray<readonly [string, string]> = [
  ["lint-baseline.json", "repo turn and repo check"],
  ["test-times.json", "the vitest shard sequencer written by `bun repo ci times`"],
];
/** The entry old installs copied into `.repo/` that nothing reads; any other unknown entry gets the allowed list. */
export const UNREAD: readonly string[] = ["scripts"];
/** The fix for an entry nothing reads. */
export const DEAD_ENTRY = "nothing reads it; move what you need out of .repo and delete it";

/** A markdown link, its target in the `target` group. */
export const MARKDOWN_LINK: Readonly<RegExp> = /\[[^\]]*\]\(\s*<?(?<target>[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
/** A fenced code block, ``` or ~~~, through its closing fence. */
export const FENCED_CODE: Readonly<RegExp> = /^(?<fence>```|~~~)[^\n]*\n[\s\S]*?^\k<fence>[^\n]*$/gm;
/** An inline code span on one line. */
export const INLINE_CODE: Readonly<RegExp> = /`[^`\n]*`/g;
/** A link target with a URL scheme: `https:`, `mailto:`. */
export const URL_SCHEME: Readonly<RegExp> = /^[a-z][a-z0-9+.-]*:/i;
/** A link target's `#anchor`, to its end. */
export const ANCHOR: Readonly<RegExp> = /#.*$/;
