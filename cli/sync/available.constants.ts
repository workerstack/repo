/** Where installed packages live, relative to the root. */
export const DEPENDENCY_DIR: string = `${"node"}_modules/`;
/** The installed `@workerstack/references` index the repo:available section is read from. */
export const AVAILABLE_INDEX_PATH: string = `${DEPENDENCY_DIR}@workerstack/references/references/INDEX.md`;
/** An index entry: `- [name](url): description`. */
export const ENTRY: RegExp = /^- \[([^\]]+)\]\(([^)]+)\): (.+)$/;
