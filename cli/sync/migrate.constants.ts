/** The file only a copied install has; it goes last, so a crash always leaves the next run what it needs to resume. */
export const COPIED_MARKER: string = ".rulesync/scripts/workspace-root.ts";
/** What every printed line starts with. */
export const PREFIX: string = "repo sync: ";
export const COPIED_DIR: string = ".rulesync";
export const REPO_DIR: string = ".repo";
export const REFERENCES_DIR: string = "references";
/** The copied install's own claude settings file, which an edited copy moves over as the overlay. */
export const COPIED_CLAUDE_SETTINGS: string = `${COPIED_DIR}/settings/claude.json`;
/** The overlay file the claude settings keys and hooks of the user go to. */
export const CLAUDE_OVERLAY: string = `${REPO_DIR}/settings/claude.json`;
export const REPLACES: string = " (it now replaces the stock one)";
export const AGENTS_MD: string = "AGENTS.md";
export const CLAUDE_SETTINGS: string = ".claude/settings.json";
export const MCP_JSON: string = ".mcp.json";
/** The generated index of a lessons dir, which stays behind for sync to rewrite. */
export const LESSONS_INDEX: string = "INDEX.md";
export const MD: string = ".md";
/** Files older inits generated into `.rulesync/reference`; never the consumer's. */
export const OLD_GENERATED_REFS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "law.md",
  "INDEX.md",
  "skills-map.md",
  "refs-map.md",
]);
/** Entries of the copied dir with a rule of their own; any other entry stops the run. */
export const HANDLED: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "rules",
  "subagents",
  "lessons",
  "hooks.jsonc",
  "mcp-policy.jsonc",
  "permissions.json",
  "global-settings",
  "reference",
  "repo.features.jsonc",
  "repo.pipeline.jsonc",
  "scripts",
  "settings",
]);
/** The files a sync can generate that a hand-written one of may move to `.repo/`. */
export const ADOPTABLE: ReadonlySet<string> = /* @__PURE__ */ new Set([AGENTS_MD, MCP_JSON, CLAUDE_SETTINGS]);
/** Each copied file that overrides stock when it differs, and what its moved line adds. */
export const OVERRIDES: readonly (readonly [string, string])[] = [
  ["hooks.jsonc", " (it now replaces the stock hooks)"],
  ["mcp-policy.jsonc", ""],
  ["permissions.json", ""],
];
export const RULE_FRONTMATTER: string = "---\ndescription: Carried over from your earlier setup\n---\n";
/** The host skill dirs an old install could hold real copies of stock skills in. */
export const HOST_SKILL_DIRS: readonly string[] = [".agents/skills/", ".claude/skills/"];
/** The same dirs as adoption lists them. */
export const SKILL_ROOTS: readonly string[] = [".agents/skills", ".claude/skills"];
/** A frontmatter fence line. */
export const FENCE: string = "---";
/** What `findIndex` returns for no match. */
export const NOT_FOUND: number = -1;
/** The bytes of randomness in a temp file name. */
export const TEMP_BYTES: number = 6;
