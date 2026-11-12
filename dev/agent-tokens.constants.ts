export const USAGE = "usage: bun dev/agent-tokens.ts <session dir> [--match <description substring>]";
export const HEADER: readonly string[] = ["agent", "model", "first-turn", "agents.md", "description"];
export const MATCH_FLAG = "--match";

/** Spaces between two columns of the table. */
export const COLUMN_GAP = 2;
export const SUBAGENTS_DIR = "subagents";
export const META_SUFFIX = ".meta.json";
export const META_SUFFIX_PATTERN: RegExp = /\.meta\.json$/;
export const TRANSCRIPT_SUFFIX = ".jsonl";
export const AGENTS_FILE = "AGENTS.md";
export const INSTRUCTIONS = "instructions";
export const ASSISTANT = "assistant";
export const NONE = "-";
export const YES = "yes";
export const NO = "no";

/** The arguments after the runtime and the script path. */
export const ARGV_START = 2;

/** What `findIndex` returns for no match. */
export const NOT_FOUND = -1;
