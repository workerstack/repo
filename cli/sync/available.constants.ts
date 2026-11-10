/** Where installed packages live, relative to the root. */
export const DEPENDENCY_DIR: string = `${"node"}_modules/`;
/** The installed `@workerstack/references` index the repo:available section is read from. */
export const AVAILABLE_INDEX_PATH: string = `${DEPENDENCY_DIR}@workerstack/references/references/INDEX.md`;
/** An index entry: `- [name](url): description`. */
export const ENTRY: RegExp = /^- \[([^\]]+)\]\(([^)]+)\): (.+)$/;
/** The open and close markers of a generated `repo:*` section, whose lines are not entries. */
export const SECTION_OPEN: RegExp = /^<!-- repo:\S+ -->$/;
export const SECTION_CLOSE: RegExp = /^<!-- \/repo:\S+ -->$/;
