/** How many hex characters of the body's sha256 an open marker carries. */
export const HASH_LENGTH = 8;

/** The extension of the shared files whose markers are HTML comments; every other shared file takes `#`. */
export const MARKDOWN_EXT = ".md";

/** The line that opens and closes YAML frontmatter, which a top region goes after. */
export const FENCE = "---";

/** The name the legacy pair goes by when no region claims it; never a real region name. */
export const LEGACY_NAME = "@workerstack/repo";

/**
 * A `#` region marker read loosely (case, spacing inside, the line already trimmed at the end): the slash of a close,
 * the name, the hash.
 */
export const HASH_MARKER: RegExp = /^#\s*(\/)?\s*repo\s*:\s*([\w.-]+)(?:\s+([\da-f]+))?$/i;

/** An HTML comment region marker read loosely, with the same groups as `HASH_MARKER`. */
export const HTML_MARKER: RegExp = /^<!--\s*(\/)?\s*repo\s*:\s*([\w.-]+)(?:\s+([\da-f]+))?\s*-->$/i;

/** The open line of the git block every version before this one wrote, with or without its label. */
export const LEGACY_OPEN: RegExp = /^#\s*>>>\s*@workerstack\/repo(?:\s.*)?$/i;

/** A markdown code fence line: up to 3 spaces, a run of 3 or more backticks or tildes, the rest of the line. */
export const CODE_FENCE: RegExp = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The close line of that git block. */
export const LEGACY_CLOSE: RegExp = /^#\s*<<<\s*@workerstack\/repo$/i;
